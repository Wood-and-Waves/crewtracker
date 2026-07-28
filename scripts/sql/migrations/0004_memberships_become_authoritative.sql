-- Multi-organization, step 3: memberships becomes the source of truth.
--
-- Migrations 0001-0003 made memberships a derived copy of profiles and pointed
-- all READS at it. This reverses the direction: the application starts WRITING
-- memberships, and profiles' organization columns become the derived copy.
--
-- That flip is what actually enables multi-organization. The old mirror deleted
-- any membership whose organization differed from profiles.organization_id — one
-- column, so at most one org per person. Nothing here adds a second membership
-- yet, but after this migration nothing deletes one either.
--
-- WHY KEEP profiles.organization_id AT ALL
-- ----------------------------------------
-- Several screens still read it: the superadmin panel, the team list, the member
-- editor, Show Access. Rather than change all of them in the same migration that
-- moves the writes — and have no way to tell which change broke something — the
-- columns stay, maintained in reverse. They are dropped in a later migration
-- once every reader has moved and been verified.
--
-- RECURSION NOTE
-- --------------
-- The policies below call my_perm(), which reads memberships — a function
-- reading the table its own policy guards. CLAUDE.md records two failures where
-- indirection did NOT avoid Postgres's RLS recursion guard, so this was tested
-- on dev before being written: it does not recurse. The earlier failures were
-- two TABLES whose policies referenced each other, which is a different shape;
-- here the inner read runs as the table owner (SECURITY DEFINER) and never
-- re-enters policy evaluation.

-- ============================================================
-- 1. Let admins write memberships
-- ============================================================
drop policy if exists "__recursion_probe" on public.memberships;

grant insert, update, delete on table public.memberships to authenticated;

drop policy if exists "Admins add members" on public.memberships;
create policy "Admins add members" on public.memberships
  for insert with check (
    organization_id = my_organization_id() and my_perm('can_manage_users')
  );

drop policy if exists "Admins change members" on public.memberships;
create policy "Admins change members" on public.memberships
  for update
  using      (organization_id = my_organization_id() and my_perm('can_manage_users'))
  with check (organization_id = my_organization_id() and my_perm('can_manage_users'));

-- No DELETE policy, deliberately. Removing someone is DEACTIVATION, not deletion:
-- shows.created_by and finalized_by point at the profile, and "who signed off
-- this payroll report" has to survive a person leaving. Deleting the membership
-- row would also silently destroy the record of what they were permitted to do.

-- Admins need to see everyone in their organization, not just themselves, for
-- the team list. Replaces the own-rows-only policy from 0001.
drop policy if exists "Users see their own memberships" on public.memberships;
create policy "Members see their org, admins see everyone" on public.memberships
  for select using (
    profile_id = auth.uid()
    or (organization_id = my_organization_id() and my_perm('can_manage_users'))
  );

-- ============================================================
-- 2. Move the safety guards onto memberships
-- ============================================================
-- Ported from enforce_profile_permission_rules() and
-- guard_profile_deactivation(), which guarded these same rules on profiles.
-- Permissions now live here, so the guards have to live here too — a guard on a
-- derived copy protects nothing.
--
-- The rules themselves are unchanged: you cannot escalate your own permissions,
-- you cannot remove your own admin rights, you cannot deactivate yourself, and
-- an organization cannot lose its last active admin.

create or replace function public.enforce_membership_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  actor uuid := auth.uid();
  actor_is_admin boolean;
begin
  -- Service role / migrations / the reverse mirror below: no acting user, so
  -- there is no actor to check. Same exemption the profiles version had.
  if actor is null then
    return new;
  end if;

  select (m.can_manage_users and m.deactivated_at is null)
    into actor_is_admin
  from memberships m
  where m.profile_id = actor and m.organization_id = new.organization_id;

  -- Rule 1: no self-escalation. Editing your own membership may not change any
  -- privileged column unless you are already an admin of that organization.
  if TG_OP = 'UPDATE' and new.profile_id = actor and coalesce(actor_is_admin, false) = false then
    if new.base_role is distinct from old.base_role
       or new.can_manage_users          is distinct from old.can_manage_users
       or new.can_manage_billing        is distinct from old.can_manage_billing
       or new.can_manage_crew_directory is distinct from old.can_manage_crew_directory
       or new.can_import_crew           is distinct from old.can_import_crew
       or new.can_view_crew_contacts    is distinct from old.can_view_crew_contacts
       or new.can_create_shows          is distinct from old.can_create_shows
       or new.can_edit_all_shows        is distinct from old.can_edit_all_shows
       or new.can_archive_shows         is distinct from old.can_archive_shows
       or new.can_duplicate_shows       is distinct from old.can_duplicate_shows
       or new.can_edit_timecards        is distinct from old.can_edit_timecards
       or new.can_approve_timecards     is distinct from old.can_approve_timecards
       or new.can_view_pay_rates        is distinct from old.can_view_pay_rates
       or new.can_edit_pay_rates        is distinct from old.can_edit_pay_rates
       or new.can_manage_rulesets       is distinct from old.can_manage_rulesets
       or new.can_view_reports          is distinct from old.can_view_reports
       or new.can_export_reports        is distinct from old.can_export_reports
       or new.can_send_reports          is distinct from old.can_send_reports
       or new.view_only                 is distinct from old.view_only then
      raise exception 'You cannot change your own role or permissions.';
    end if;
  end if;

  -- Rule 2: an admin cannot remove their own admin rights (lockout protection).
  if TG_OP = 'UPDATE' and new.profile_id = actor
     and coalesce(old.can_manage_users, false) and not coalesce(new.can_manage_users, false) then
    raise exception 'You cannot remove your own user-management permission.';
  end if;

  -- Rule 3: you cannot deactivate or restore yourself.
  if TG_OP = 'UPDATE' and new.profile_id = actor
     and new.deactivated_at is distinct from old.deactivated_at then
    raise exception 'You cannot deactivate or reactivate your own account.';
  end if;

  -- Rule 4: the organization must keep at least one active admin. Covers both
  -- routes to losing one — dropping the permission, and deactivating the person.
  if TG_OP = 'UPDATE' and coalesce(old.can_manage_users, false) and old.deactivated_at is null then
    if (not coalesce(new.can_manage_users, false)) or new.deactivated_at is not null then
      if (select count(*) from memberships
          where organization_id = old.organization_id
            and can_manage_users
            and deactivated_at is null
            and profile_id <> old.profile_id) = 0 then
        raise exception 'This is the organization''s last active admin; grant another admin first.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists memberships_enforce_rules on public.memberships;
create trigger memberships_enforce_rules
  before update on public.memberships
  for each row execute function public.enforce_membership_rules();

-- The profiles guards are now guarding a derived copy, and worse, they would
-- fire on the reverse mirror below and reject its writes as "changing your own
-- permissions". Their rules live in enforce_membership_rules() above.
drop trigger if exists enforce_profile_permission_rules on public.profiles;
drop trigger if exists profiles_guard_deactivation on public.profiles;

-- ============================================================
-- 3. Reverse the mirror: memberships -> profiles
-- ============================================================
drop trigger if exists profiles_mirror_membership on public.profiles;
drop trigger if exists profiles_set_active_organization on public.profiles;

create or replace function public.sync_profile_from_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target uuid := coalesce(new.profile_id, old.profile_id);
  chosen memberships%rowtype;
begin
  -- Pick the membership this person's legacy profile columns should reflect:
  -- their active organization if that is still a live membership, otherwise the
  -- oldest one they hold. Deactivated memberships are a last resort so the
  -- columns do not advertise access that no longer works.
  select m.* into chosen
  from memberships m
  join profiles p on p.id = m.profile_id
  where m.profile_id = target
  order by (m.organization_id = p.active_organization_id) desc,
           (m.deactivated_at is null) desc,
           m.created_at
  limit 1;

  if not found then
    update profiles set organization_id = null, active_organization_id = null
     where id = target;
    return coalesce(new, old);
  end if;

  update profiles set
    organization_id           = chosen.organization_id,
    -- Only repoint the active organization if it no longer resolves. Overwriting
    -- it unconditionally would drag a multi-org user back to one organization
    -- every time any of their memberships was touched.
    active_organization_id    = case
      when active_organization_id is null
        or not exists (select 1 from memberships m2
                       where m2.profile_id = target
                         and m2.organization_id = profiles.active_organization_id)
      then chosen.organization_id
      else active_organization_id
    end,
    base_role                 = chosen.base_role,
    deactivated_at            = chosen.deactivated_at,
    can_manage_users          = chosen.can_manage_users,
    can_manage_billing        = chosen.can_manage_billing,
    can_manage_crew_directory = chosen.can_manage_crew_directory,
    can_import_crew           = chosen.can_import_crew,
    can_view_crew_contacts    = chosen.can_view_crew_contacts,
    can_create_shows          = chosen.can_create_shows,
    can_edit_all_shows        = chosen.can_edit_all_shows,
    can_archive_shows         = chosen.can_archive_shows,
    can_duplicate_shows       = chosen.can_duplicate_shows,
    can_edit_timecards        = chosen.can_edit_timecards,
    can_approve_timecards     = chosen.can_approve_timecards,
    can_view_pay_rates        = chosen.can_view_pay_rates,
    can_edit_pay_rates        = chosen.can_edit_pay_rates,
    can_manage_rulesets       = chosen.can_manage_rulesets,
    can_view_reports          = chosen.can_view_reports,
    can_export_reports        = chosen.can_export_reports,
    can_send_reports          = chosen.can_send_reports,
    view_only                 = chosen.view_only,
    updated_at                = now()
  where id = target;

  return coalesce(new, old);
end;
$$;

drop trigger if exists memberships_mirror_profile on public.memberships;
create trigger memberships_mirror_profile
  after insert or update or delete on public.memberships
  for each row execute function public.sync_profile_from_membership();

-- ============================================================
-- 4. Reconcile once, so the two agree from the outset
-- ============================================================
update public.memberships set updated_at = updated_at;
