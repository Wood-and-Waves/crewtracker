-- Multi-organization data model, step 1 of 3: the memberships table.
--
-- WHY
-- ---
-- `profiles.organization_id` is a single column, so one login belongs to exactly
-- one organization. That blocks the planned crew login: crew who punch their own
-- time work for several production companies, and one human needs one identity
-- spanning all of them. Retrofitting that while live crew are punching would be
-- far worse than doing it now, which is the whole reason this is happening
-- before there are real customers.
--
-- THE SPLIT
--   profiles     — facts about a PERSON: name, email, 24-hour time, shoulder
--                  surfer, is_super_admin. Plus active_organization_id, added
--                  here, which says which org they are currently acting in.
--   memberships  — facts about a person IN AN ORG: base_role, all 18 can_*
--                  permissions, deactivated_at. Permissions are per-org because
--                  someone can be an admin at one company and crew at another.
--
-- WHY THIS DOESN'T BREAK ANYTHING TODAY
-- -------------------------------------
-- The application still reads and writes `profiles` exactly as before. A trigger
-- mirrors those writes into `memberships`, one row per profile, so the new table
-- is always current without a single line of app code changing. RLS is switched
-- over to read memberships in migration 0002. Once the app itself writes
-- memberships, the mirror and the old columns come out — but not in this pass.
-- This is deliberately the boring, reversible half of the change.
--
-- NOTE ON THE RLS POLICY BELOW
-- ----------------------------
-- memberships gets ONE policy: you can see your own rows. It deliberately does
-- NOT call my_organization_id(), because that function reads memberships, and
-- CLAUDE.md records two failed attempts to indirect an RLS cycle through a
-- SECURITY DEFINER function — the recursion guard is structural. A self-contained
-- predicate cannot recurse. The app doesn't read this table yet anyway; the
-- mirror trigger and the helpers are SECURITY DEFINER and bypass RLS as owner.

-- ============================================================
-- 1. The table
-- ============================================================
create table if not exists public.memberships (
  id                        uuid primary key default gen_random_uuid(),
  profile_id                uuid not null references public.profiles(id) on delete cascade,
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  base_role                 text default 'crew',
  can_manage_users          boolean default false,
  can_manage_billing        boolean default false,
  can_manage_crew_directory boolean default false,
  can_import_crew           boolean default false,
  can_view_crew_contacts    boolean default false,
  can_create_shows          boolean default false,
  can_edit_all_shows        boolean default false,
  can_archive_shows         boolean default false,
  can_duplicate_shows       boolean default false,
  can_edit_timecards        boolean default false,
  can_approve_timecards     boolean default false,
  can_view_pay_rates        boolean default false,
  can_edit_pay_rates        boolean default false,
  can_manage_rulesets       boolean default false,
  can_view_reports          boolean default false,
  can_export_reports        boolean default false,
  can_send_reports          boolean default false,
  view_only                 boolean default false,
  deactivated_at            timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint memberships_profile_org_uniq unique (profile_id, organization_id)
);

create index if not exists memberships_profile_idx on public.memberships (profile_id);
create index if not exists memberships_org_idx     on public.memberships (organization_id);

alter table public.memberships enable row level security;

drop policy if exists "Users see their own memberships" on public.memberships;
create policy "Users see their own memberships" on public.memberships
  for select using (profile_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies: every write goes through the SECURITY
-- DEFINER mirror below. Adding write policies before anything needs them would
-- be the retrofit-gap-in-reverse — surface area with no caller.

-- ============================================================
-- 2. Which organization is this person currently acting in
-- ============================================================
alter table public.profiles add column if not exists active_organization_id uuid
  references public.organizations(id) on delete set null;

-- ============================================================
-- 3. Mirror profiles -> memberships
-- ============================================================
-- Direction is one-way on purpose. Two-way sync between a table and its
-- replacement is a reliable source of loops and lost updates; this pass keeps
-- profiles authoritative and memberships derived, and the next pass reverses it
-- in one deliberate step rather than living in an ambiguous middle.

create or replace function public.sync_membership_from_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.organization_id is null then
    -- Left the org (or never joined). Remove the mirrored row so no stale
    -- membership can keep granting access after profiles says they're out.
    delete from memberships where profile_id = new.id;
    return new;
  end if;

  insert into memberships (
    profile_id, organization_id, base_role, deactivated_at,
    can_manage_users, can_manage_billing, can_manage_crew_directory, can_import_crew,
    can_view_crew_contacts, can_create_shows, can_edit_all_shows, can_archive_shows,
    can_duplicate_shows, can_edit_timecards, can_approve_timecards, can_view_pay_rates,
    can_edit_pay_rates, can_manage_rulesets, can_view_reports, can_export_reports,
    can_send_reports, view_only
  ) values (
    new.id, new.organization_id, new.base_role, new.deactivated_at,
    new.can_manage_users, new.can_manage_billing, new.can_manage_crew_directory, new.can_import_crew,
    new.can_view_crew_contacts, new.can_create_shows, new.can_edit_all_shows, new.can_archive_shows,
    new.can_duplicate_shows, new.can_edit_timecards, new.can_approve_timecards, new.can_view_pay_rates,
    new.can_edit_pay_rates, new.can_manage_rulesets, new.can_view_reports, new.can_export_reports,
    new.can_send_reports, new.view_only
  )
  on conflict (profile_id, organization_id) do update set
    base_role                 = excluded.base_role,
    deactivated_at            = excluded.deactivated_at,
    can_manage_users          = excluded.can_manage_users,
    can_manage_billing        = excluded.can_manage_billing,
    can_manage_crew_directory = excluded.can_manage_crew_directory,
    can_import_crew           = excluded.can_import_crew,
    can_view_crew_contacts    = excluded.can_view_crew_contacts,
    can_create_shows          = excluded.can_create_shows,
    can_edit_all_shows        = excluded.can_edit_all_shows,
    can_archive_shows         = excluded.can_archive_shows,
    can_duplicate_shows       = excluded.can_duplicate_shows,
    can_edit_timecards        = excluded.can_edit_timecards,
    can_approve_timecards     = excluded.can_approve_timecards,
    can_view_pay_rates        = excluded.can_view_pay_rates,
    can_edit_pay_rates        = excluded.can_edit_pay_rates,
    can_manage_rulesets       = excluded.can_manage_rulesets,
    can_view_reports          = excluded.can_view_reports,
    can_export_reports        = excluded.can_export_reports,
    can_send_reports          = excluded.can_send_reports,
    view_only                 = excluded.view_only,
    updated_at                = now();

  -- While profiles remains the source of truth it holds exactly one org, so a
  -- profile must mirror to exactly one membership. If someone is moved from org
  -- A to org B, drop the stale A row — otherwise it would keep granting access
  -- to an organization they are no longer in.
  --
  -- This is also precisely what caps the system at one org per person for now,
  -- and it is meant to: this pass builds the SHAPE. Genuine multi-org arrives
  -- when the app writes memberships directly and this mirror is deleted.
  delete from memberships
   where profile_id = new.id and organization_id <> new.organization_id;

  return new;
end;
$$;

-- BEFORE, so active_organization_id is set on the row being written rather than
-- by a second UPDATE (which would re-enter this trigger).
create or replace function public.set_active_organization()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.organization_id is null then
    new.active_organization_id := null;
  elsif new.active_organization_id is distinct from new.organization_id then
    new.active_organization_id := new.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_active_organization on public.profiles;
create trigger profiles_set_active_organization
  before insert or update on public.profiles
  for each row execute function public.set_active_organization();

-- AFTER, because on INSERT the profiles row must exist before memberships can
-- reference it.
drop trigger if exists profiles_mirror_membership on public.profiles;
create trigger profiles_mirror_membership
  after insert or update on public.profiles
  for each row execute function public.sync_membership_from_profile();

-- ============================================================
-- 4. Backfill from what exists today
-- ============================================================
update public.profiles set active_organization_id = organization_id
 where organization_id is not null and active_organization_id is distinct from organization_id;

insert into public.memberships (
  profile_id, organization_id, base_role, deactivated_at,
  can_manage_users, can_manage_billing, can_manage_crew_directory, can_import_crew,
  can_view_crew_contacts, can_create_shows, can_edit_all_shows, can_archive_shows,
  can_duplicate_shows, can_edit_timecards, can_approve_timecards, can_view_pay_rates,
  can_edit_pay_rates, can_manage_rulesets, can_view_reports, can_export_reports,
  can_send_reports, view_only
)
select
  p.id, p.organization_id, p.base_role, p.deactivated_at,
  p.can_manage_users, p.can_manage_billing, p.can_manage_crew_directory, p.can_import_crew,
  p.can_view_crew_contacts, p.can_create_shows, p.can_edit_all_shows, p.can_archive_shows,
  p.can_duplicate_shows, p.can_edit_timecards, p.can_approve_timecards, p.can_view_pay_rates,
  p.can_edit_pay_rates, p.can_manage_rulesets, p.can_view_reports, p.can_export_reports,
  p.can_send_reports, p.view_only
from public.profiles p
where p.organization_id is not null
on conflict (profile_id, organization_id) do nothing;

revoke all on table public.memberships from anon, authenticated;
grant select on table public.memberships to authenticated;
