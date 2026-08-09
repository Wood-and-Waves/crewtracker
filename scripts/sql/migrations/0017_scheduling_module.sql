-- Scheduling becomes a switchable module: an org-level entitlement plus a
-- per-user permission.
--
-- WHY
-- ---
-- Dan, 2026-08-07: "maybe not everyone will use scheduling. Or maybe that will
-- be a paid upgrade as it involves email and such." The landing page sells the
-- tracker — AV math, batch punching, exports — and has never mentioned
-- scheduling, so the commercial shape matches the product shape: the tracker is
-- the product, scheduling is an add-on.
--
-- THIS MIGRATION DELETES NOTHING AND GATES NOTHING IN RLS.
-- --------------------------------------------------------
-- Turning the module off HIDES it for an organization. Every scheduling table,
-- column and row stays exactly where it is, so switching back on restores the
-- feature whole. That matters beyond politeness: timecards.booking_status is
-- read by lib/timecardFields.ts, which reports, exports and the emailed Final
-- Report all funnel through. Leave the column alone and that decline filter
-- keeps working; with scheduling off nothing ever reaches 'declined', so the
-- rule is simply inert.
--
-- Enforcement is in the app, not in RLS, matching the call already recorded for
-- organizations.disabled_at (scripts/sql/applied/superadmin-and-org-disable.sql):
-- a commercial state is not a security boundary, and an RLS gate here would risk
-- cutting a downgraded customer off from exports they are still owed.
--
-- 1. organizations.scheduling_enabled — the entitlement
-- ----------------------------------------------------
-- DEFAULT TRUE, deliberately. Every organization that exists today keeps
-- scheduling, and new ones get it during the beta; the flag is flipped OFF per
-- customer from the superadmin panel. When billing arrives, Stripe sets this
-- column — which is why the entitlement lives here and NOT on subscriptions.plan:
-- plan names change, and you must be able to grant scheduling to a beta customer
-- without inventing a fake plan for them.

alter table public.organizations
  add column if not exists scheduling_enabled boolean not null default true;

comment on column public.organizations.scheduling_enabled is
  'Entitlement: may this organization use the scheduling module (positions, booking requests, the company calendar)? Operator-controlled — see guard_organization_disabled_at(). Nothing scheduling-related is deleted when this is false; the UI is hidden.';

-- 2. The guard — WITHOUT THIS THE FLAG IS WORTHLESS
-- -------------------------------------------------
-- organizations' UPDATE policy ("org_admins_update_own_org") is COLUMN-BLIND:
-- it allows any admin of an org to write ANY column of their own org row. So a
-- customer could switch on their own paid feature with one crafted request.
-- disabled_at has exactly this problem and is protected by a trigger rather than
-- by RLS; scheduling_enabled joins it.
--
-- The function name is now historical — it guards two columns, not one. Renaming
-- it would mean dropping and recreating the trigger for no behavioural gain, so
-- the name stays and this comment carries the truth.
create or replace function public.guard_organization_disabled_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new;                       -- service role / direct SQL
  end if;
  if new.disabled_at is distinct from old.disabled_at then
    raise exception 'Organization status can only be changed by CrewTracker support.';
  end if;
  if new.scheduling_enabled is distinct from old.scheduling_enabled then
    raise exception 'The scheduling module can only be changed by CrewTracker support.';
  end if;
  return new;
end;
$$;

comment on function public.guard_organization_disabled_at() is
  'Blocks operator-only columns on organizations (disabled_at, scheduling_enabled) from being changed by an authenticated caller. Name is historical: it guards more than disabled_at.';

-- 3. memberships.can_manage_scheduling — the per-user permission
-- -------------------------------------------------------------
-- The org flag says the COMPANY bought it; this says which people inside that
-- company may use it. Same two-gate shape as canSeeFinancials(user, show) in
-- lib/session.ts, where a per-entity flag and a per-user permission must BOTH
-- pass.
--
-- DEFAULT FALSE matches every other permission column, and lib/permissions.ts
-- seeds the real value per role on invite acceptance (admin and pm true, staff
-- false). Existing members are backfilled below from their current role, so
-- nobody who is doing this job today loses the ability tomorrow.
alter table public.memberships
  add column if not exists can_manage_scheduling boolean not null default false;

comment on column public.memberships.can_manage_scheduling is
  'May this member use the scheduling module (positions, handoff, booking requests)? Gated additionally by organizations.scheduling_enabled — both must be true.';

-- Backfill: anyone who can already create or edit shows across the company is
-- doing the scheduling job today. Written as a permission test rather than a
-- base_role test because permissions are individually customisable — reading
-- the actual capability is truer than reading the label.
update public.memberships
set can_manage_scheduling = true
where deactivated_at is null
  and (can_manage_users = true or can_create_shows = true or can_edit_all_shows = true);

-- 4. Grants
-- ---------
-- authenticated already holds table-level SELECT/UPDATE on both tables; a new
-- column inherits nothing automatically where column-level grants are in play,
-- so be explicit. memberships.can_manage_scheduling is readable by the member
-- (getCurrentUser selects every permission key) and writable only through the
-- existing admin policies on memberships.
grant select (scheduling_enabled) on public.organizations to authenticated;
grant select (can_manage_scheduling), update (can_manage_scheduling)
  on public.memberships to authenticated;

-- Deliberately NO grant of update(scheduling_enabled) to authenticated: the
-- superadmin route writes it with the service role, and the guard above rejects
-- any authenticated attempt regardless.
