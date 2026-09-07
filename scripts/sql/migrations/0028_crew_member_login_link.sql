-- A directory entry learns which login it is (Section 1 of the 2026-09-06 spec).
--
-- Dan: "email is what will drive the crew logon." So the link is made by EMAIL,
-- automatically, with two guard rails: only inside ONE organization (Company
-- B's entry for the same person links only to that person's membership in B;
-- nothing ever matches across companies — the cross-org rule in CLAUDE.md),
-- and only when exactly ONE directory entry in the company carries the email
-- AND exactly one live member does. Zero or several → no link, and the Edit
-- Crew page says why.
--
-- Nothing reads profile_id until 0029. With no links, nothing changes.
--
-- WRITES EXISTING ROWS: the backfill at the end sets profile_id on every
-- directory entry whose email matches exactly one member of its company.

alter table public.crew_members
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

-- One directory entry per login per company.
create unique index if not exists crew_members_org_profile_uniq
  on public.crew_members (organization_id, profile_id) where profile_id is not null;

-- The one rule, in one place. Returns the profile linked (or null). SECURITY
-- DEFINER: it reads profiles/memberships across the organization, which the
-- caller may not be allowed to see directly. search_path pinned.
create or replace function public.relink_crew_member(p_crew_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_email text;
  v_profile uuid;
  v_twins integer;
  v_members integer;
begin
  select organization_id, lower(trim(email)) into v_org, v_email
  from crew_members where id = p_crew_member_id;
  if v_org is null then return null; end if;

  if v_email is null or v_email = '' then
    update crew_members set profile_id = null where id = p_crew_member_id and profile_id is not null;
    return null;
  end if;

  -- Exactly one directory entry in this company with this email, or nothing.
  select count(*) into v_twins from crew_members
  where organization_id = v_org and lower(trim(email)) = v_email;
  if v_twins <> 1 then
    update crew_members set profile_id = null where id = p_crew_member_id and profile_id is not null;
    return null;
  end if;

  -- Exactly one live member of this company with this email, or nothing.
  select count(*), min(p.id::text)::uuid into v_members, v_profile
  from memberships m join profiles p on p.id = m.profile_id
  where m.organization_id = v_org and m.deactivated_at is null
    and lower(trim(p.email)) = v_email;
  if v_members <> 1 then v_profile := null; end if;

  update crew_members set profile_id = v_profile
  where id = p_crew_member_id and profile_id is distinct from v_profile;
  return v_profile;
end;
$$;
revoke execute on function public.relink_crew_member(uuid) from public, anon;
grant execute on function public.relink_crew_member(uuid) to authenticated, service_role;

-- Directory side: a new entry, or an email change.
create or replace function public.crew_members_link_login_tg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  perform relink_crew_member(new.id);
  -- An email change can also free a twin that was blocked by this row.
  if tg_op = 'UPDATE' and old.email is distinct from new.email and old.email is not null then
    for v_id in select id from crew_members
      where organization_id = new.organization_id and id <> new.id
        and lower(trim(email)) = lower(trim(old.email)) loop
      perform relink_crew_member(v_id);
    end loop;
  end if;
  return null;
end; $$;
drop trigger if exists crew_members_link_login on public.crew_members;
create trigger crew_members_link_login
  after insert or update of email on public.crew_members
  for each row execute function public.crew_members_link_login_tg();

-- Login side: somebody joins (or is reactivated in / removed from) a company.
create or replace function public.memberships_link_crew_tg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_email text; v_id uuid;
begin
  select lower(trim(email)) into v_email from profiles where id = new.profile_id;
  if v_email is null then return null; end if;
  for v_id in select id from crew_members
    where organization_id = new.organization_id and lower(trim(email)) = v_email loop
    perform relink_crew_member(v_id);
  end loop;
  return null;
end; $$;
drop trigger if exists memberships_link_crew on public.memberships;
create trigger memberships_link_crew
  after insert or update of deactivated_at on public.memberships
  for each row execute function public.memberships_link_crew_tg();

-- memberships.base_role has no check constraint (verified on dev 2026-09-06),
-- so the new 'crew' preset needs nothing here. If one is ever added it must
-- include 'crew'.

-- Backfill: every existing entry with an email, same rule.
do $$
declare r record;
begin
  for r in select id from crew_members where email is not null loop
    perform relink_crew_member(r.id);
  end loop;
end $$;

-- Column grant: crew_members is table-granted, so nothing to add. The app
-- writes profile_id only to NULL (Unlink); the triggers own every other value.
