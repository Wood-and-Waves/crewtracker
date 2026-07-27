-- Multi-organization data model, step 3 of 3: the 11 policies that read profiles.
--
-- Every one of them has the same shape today:
--     (organization_id = my_organization_id())
--     AND (select can_X from profiles where id = auth.uid())
-- which is `my_perm('can_X')` written out longhand, eleven times, against a table
-- that is about to stop being the source of permissions. Replacing the longhand
-- with the helper is what makes these policies immune to the next move as well —
-- the same reason the other 32 policies need no changes in this migration.
--
-- BEHAVIOUR IS UNCHANGED. The old scalar subquery returned NULL when the caller
-- had no profile row, and `x AND NULL` is NULL, which denies. my_perm returns
-- false, and `x AND false` is false, which also denies. Every other case reads
-- the same value from the mirrored membership.
--
-- Policies are dropped and recreated rather than altered because Postgres has no
-- ALTER POLICY that can replace an expression wholesale, and a half-edited
-- policy is worse than a briefly absent one inside a transaction.

-- ============================================================
-- crew_members
-- ============================================================
drop policy if exists "Users can manage crew if permitted" on public.crew_members;
create policy "Users can manage crew if permitted" on public.crew_members
  for all using (
    organization_id = my_organization_id() and my_perm('can_manage_crew_directory')
  );

-- ============================================================
-- invitations
-- ============================================================
drop policy if exists "Admins can manage invitations" on public.invitations;
create policy "Admins can manage invitations" on public.invitations
  for all using (
    organization_id = my_organization_id() and my_perm('can_manage_users')
  );

-- ============================================================
-- organizations
-- ============================================================
drop policy if exists "org_admins_update_own_org" on public.organizations;
create policy "org_admins_update_own_org" on public.organizations
  for update
  using       (id = my_organization_id() and my_perm('can_manage_users'))
  with check  (id = my_organization_id() and my_perm('can_manage_users'));

-- ============================================================
-- payroll_presets
-- ============================================================
drop policy if exists "presets_insert_own_org" on public.payroll_presets;
create policy "presets_insert_own_org" on public.payroll_presets
  for insert
  with check (organization_id = my_organization_id() and my_perm('can_manage_rulesets'));

drop policy if exists "presets_update_own_org" on public.payroll_presets;
create policy "presets_update_own_org" on public.payroll_presets
  for update
  using      (organization_id = my_organization_id() and my_perm('can_manage_rulesets'))
  with check (organization_id = my_organization_id() and my_perm('can_manage_rulesets'));

drop policy if exists "presets_delete_own_org" on public.payroll_presets;
create policy "presets_delete_own_org" on public.payroll_presets
  for delete
  using (organization_id = my_organization_id() and my_perm('can_manage_rulesets'));

-- ============================================================
-- show_assignments
-- ============================================================
-- The target check confirms the person being granted access is in the caller's
-- organization — the cross-org hole real testing found when C1 shipped. It now
-- reads memberships, which is exactly equivalent while the mirror runs: a
-- membership row exists for precisely those profiles whose organization_id is
-- set, and it is deleted the moment they leave.
--
-- NOTE: neither version excludes a DEACTIVATED member. That is deliberate
-- parity, not an oversight — assigning a show to a removed teammate is harmless
-- today because every other policy already denies them everything. Worth
-- tightening on its own merits, not smuggled into a migration whose entire
-- claim is that nothing changes.
drop policy if exists "Admins assign members to shows" on public.show_assignments;
create policy "Admins assign members to shows" on public.show_assignments
  for insert
  with check (
    organization_id = my_organization_id()
    and my_perm('can_manage_users')
    and exists (
      select 1 from public.memberships m
      where m.profile_id = show_assignments.profile_id
        and m.organization_id = my_organization_id()
    )
  );

drop policy if exists "Admins revoke member show access" on public.show_assignments;
create policy "Admins revoke member show access" on public.show_assignments
  for delete
  using (organization_id = my_organization_id() and my_perm('can_manage_users'));

-- ============================================================
-- shows
-- ============================================================
drop policy if exists "Users can create shows if permitted" on public.shows;
create policy "Users can create shows if permitted" on public.shows
  for insert
  with check (organization_id = my_organization_id() and my_perm('can_create_shows'));

-- Visibility is unchanged: see-all, or assigned, or you created it. Note this
-- references show_assignments, and shows' SELECT policy does too — that pairing
-- is the documented recursion hazard, so the shape here is left exactly as it
-- was rather than "tidied".
drop policy if exists "Users can update shows they can see" on public.shows;
create policy "Users can update shows they can see" on public.shows
  for update
  using (
    organization_id = my_organization_id()
    and my_perm('can_edit_timecards')
    and (
      can_see_all_shows()
      or id in (select show_id from public.show_assignments where profile_id = auth.uid())
      or created_by = auth.uid()
    )
  )
  with check (organization_id = my_organization_id());

-- ============================================================
-- subscriptions
-- ============================================================
drop policy if exists "Only admins can update subscription" on public.subscriptions;
create policy "Only admins can update subscription" on public.subscriptions
  for update
  using (organization_id = my_organization_id() and my_perm('can_manage_billing'));

-- ============================================================
-- The pay-rate write guard
-- ============================================================
-- Same substitution, in the trigger that enforces can_edit_pay_rates. The rest
-- of the function — the pg_trigger_depth exemption for the show-wide rate
-- cascade, the null-auth.uid() exemption for the service role, raising on UPDATE
-- but silently dropping the rate on INSERT so staffing still works — is
-- deliberately untouched. See scripts/sql/applied/enforce-pay-rate-writes.sql.
--
-- Left alone on purpose: enforce_profile_permission_rules() and
-- guard_profile_deactivation(). Both are BEFORE triggers ON profiles, and
-- profiles is still the source of truth this pass; the memberships mirror is an
-- AFTER trigger, so during their execution memberships still holds the previous
-- values. Pointing them at memberships now would mean reasoning about that skew
-- for no benefit. They move when the app starts writing memberships.
create or replace function public.enforce_pay_rate_write_permission()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- System cascade or no user in context: not a user-initiated rate change.
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.day_rate is not distinct from OLD.day_rate then
    return NEW;                       -- rate untouched; nothing to authorise
  end if;

  if TG_OP = 'INSERT' and NEW.day_rate is null then
    return NEW;                       -- no rate supplied
  end if;

  if my_perm('can_edit_pay_rates') then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    raise exception 'You do not have permission to change pay rates.'
      using errcode = 'check_violation';
  end if;

  -- INSERT: drop the rate rather than refuse the row.
  NEW.day_rate := null;
  return NEW;
end;
$$;
