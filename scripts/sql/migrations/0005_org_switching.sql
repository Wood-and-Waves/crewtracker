-- Multi-organization, step 5: make switching possible, and close a gap from 0004.
--
-- ============================================================
-- 1. You can see the organizations you belong to
-- ============================================================
-- The existing policy exposes exactly one organization: `id = my_organization_id()`,
-- which resolves only the ACTIVE one. A switcher cannot even name the alternatives
-- under that rule, so someone with two memberships could never leave the first.
--
-- Widened to "any organization you hold a live membership in". Note this grants
-- strictly less than it might appear: it exposes an organization's NAME to its own
-- members, nothing else. Every other table stays scoped to my_organization_id(),
-- so being able to see that Company B exists does not make any of Company B's
-- shows, crew or rates readable while you are acting in Company A.
drop policy if exists "Users see their own organization" on public.organizations;
create policy "Users see organizations they belong to" on public.organizations
  for select using (
    exists (
      select 1 from public.memberships m
      where m.profile_id = auth.uid()
        and m.organization_id = organizations.id
        and m.deactivated_at is null
    )
  );

-- ============================================================
-- 2. Close the self-write gap opened in 0004
-- ============================================================
-- 0004 dropped enforce_profile_permission_rules because it fired on the reverse
-- mirror and rejected its writes. That was necessary, but it left profiles'
-- org-derived columns writable by their owner via "Users can update their own
-- profile".
--
-- Nothing is actually escalated by that today — permissions are read from
-- memberships, so a self-set profiles.can_manage_users grants precisely nothing,
-- and the mirror overwrites it on the next membership change. But "inert today"
-- is a poor reason to leave a writable permission column lying around, and it
-- would quietly mislead any screen still reading profiles.
--
-- Exempts pg_trigger_depth() > 1 so the mirror (which updates profiles from
-- inside a trigger, at depth 2) is unaffected, and a null auth.uid() for the
-- service role and migrations. Same technique as enforce_pay_rate_write_permission.
create or replace function public.guard_profile_derived_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;                      -- mirror, service role, or migration
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.base_role      is distinct from old.base_role
     or new.deactivated_at is distinct from old.deactivated_at
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
    raise exception 'Organization membership and permissions are managed on the membership, not the profile.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_derived on public.profiles;
create trigger profiles_guard_derived
  before update on public.profiles
  for each row execute function public.guard_profile_derived_columns();

-- Deliberately NOT guarded: active_organization_id. That is the switcher, and it
-- is safe for anyone to set to anything — my_organization_id() and my_perm() both
-- re-check that a live membership exists for whatever it points at, so pointing it
-- at another company's id resolves to null and grants nothing. Verified on dev by
-- setting it to an organization the user had no membership in: every table
-- returned zero rows.
