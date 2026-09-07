-- Section 2 of the 2026-09-06 spec: a staffed login sees only its own rows.
--
-- THE NEW DOOR. A show is visible when (today) can_see_all_shows() OR
-- created_by OR scheduler_id OR on show_assignments — OR (new) the caller's
-- linked directory entry has a live timecard on it. The shows policy must not
-- read timecards (timecards' policy reads shows — the recursion incident in
-- CLAUDE.md), so the fact lives in a bookkeeping table kept true by triggers,
-- exactly like show_assignments.organization_id.
--
-- PM-SIDE vs CREW-SIDE. On a visible show you are PM-side (see everything) if
-- can_see_all_shows(), or you created it, or you are its scheduler, or you are
-- on its access list — my_pm_show_ids(). Otherwise you are crew-side and see
-- only timecards whose crew_member is linked to you — my_crew_member_ids().
-- Both helpers are used as `in (select fn())`: one hashed subplan, never per row.
--
-- WRITES. is_own_timecard() — the placeholder 0019 left returning false — is
-- real from here. Timecard writes stay can_edit_timecards only.
--
-- NO CHANGE FOR EXISTING USERS: with no links, show_crew_access is empty and
-- my_crew_member_ids() is empty, so every rule reduces to today's.

-- 1. The bookkeeping table.
create table if not exists public.show_crew_access (
  show_id         uuid not null references public.shows(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (show_id, profile_id)
);
create index if not exists show_crew_access_profile_idx on public.show_crew_access (profile_id);
alter table public.show_crew_access enable row level security;
alter table public.show_crew_access force row level security;
-- Its policy references nothing but itself, so it can never form a cycle.
drop policy if exists "Users see their own crew access" on public.show_crew_access;
create policy "Users see their own crew access" on public.show_crew_access
  for select using (profile_id = (select auth.uid()));
grant select on public.show_crew_access to authenticated;

-- 2. Recompute for one (show, profile): a row exists iff a live timecard links them.
create or replace function public.refresh_show_crew_access(p_show_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_live boolean; v_org uuid;
begin
  if p_show_id is null or p_profile_id is null then return; end if;
  select exists (
    select 1 from timecards t join crew_members cm on cm.id = t.crew_member_id
    where t.show_id = p_show_id and cm.profile_id = p_profile_id
      and t.booking_status is distinct from 'declined'
  ) into v_live;
  if v_live then
    select organization_id into v_org from shows where id = p_show_id;
    insert into show_crew_access (show_id, profile_id, organization_id)
    values (p_show_id, p_profile_id, v_org) on conflict do nothing;
  else
    delete from show_crew_access where show_id = p_show_id and profile_id = p_profile_id;
  end if;
end; $$;

-- 3. Triggers that keep it true.
create or replace function public.timecards_crew_access_tg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_old uuid; v_new uuid;
begin
  if tg_op in ('DELETE','UPDATE') then
    select profile_id into v_old from crew_members where id = old.crew_member_id;
    perform refresh_show_crew_access(old.show_id, v_old);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select profile_id into v_new from crew_members where id = new.crew_member_id;
    perform refresh_show_crew_access(new.show_id, v_new);
  end if;
  return null;
end; $$;
drop trigger if exists timecards_crew_access on public.timecards;
create trigger timecards_crew_access
  after insert or delete or update of crew_member_id, booking_status, show_id on public.timecards
  for each row execute function public.timecards_crew_access_tg();

create or replace function public.crew_members_crew_access_tg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  for r in select distinct show_id from timecards where crew_member_id = new.id loop
    if old.profile_id is not null then perform refresh_show_crew_access(r.show_id, old.profile_id); end if;
    if new.profile_id is not null then perform refresh_show_crew_access(r.show_id, new.profile_id); end if;
  end loop;
  return null;
end; $$;
drop trigger if exists crew_members_crew_access on public.crew_members;
create trigger crew_members_crew_access
  after update of profile_id on public.crew_members
  for each row execute function public.crew_members_crew_access_tg();

-- Backfill: every (show, linked profile) pair that exists today.
do $$ declare r record; begin
  for r in select distinct t.show_id, cm.profile_id from timecards t
           join crew_members cm on cm.id = t.crew_member_id where cm.profile_id is not null loop
    perform refresh_show_crew_access(r.show_id, r.profile_id);
  end loop;
end $$;

-- 4. Helpers.
create or replace function public.my_crew_member_ids() returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select id from crew_members where profile_id = auth.uid();
$$;

create or replace function public.my_pm_show_ids() returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select s.id from shows s
  where s.organization_id = my_organization_id()
    and ( can_see_all_shows()
       or s.created_by = auth.uid()
       or s.scheduler_id = auth.uid()
       or s.id in (select show_id from show_assignments where profile_id = auth.uid()) );
$$;

create or replace function public.is_own_timecard(p_timecard_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from timecards t join crew_members cm on cm.id = t.crew_member_id
    where t.id = p_timecard_id and cm.profile_id = auth.uid()
  );
$$;

-- 5. Policies. shows gains the door; timecards/punches filter per side.
alter policy "Users see their org shows" on public.shows
  using (
    organization_id = (select my_organization_id())
    and (
      (select can_see_all_shows())
      or id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or created_by = (select auth.uid())
      or scheduler_id = (select auth.uid())
      or id in (select show_id from show_crew_access where profile_id = (select auth.uid()))
    )
  );

alter policy "Users see timecards for their shows" on public.timecards
  using (
    show_id in (select id from shows)
    and ( show_id in (select my_pm_show_ids())
       or crew_member_id in (select my_crew_member_ids()) )
  );

alter policy "Users see punches for their timecards" on public.punches
  using (show_id in (select id from shows) and timecard_id in (select id from timecards));
