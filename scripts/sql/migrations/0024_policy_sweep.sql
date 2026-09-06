-- The mechanical sweep 0021 deferred: every remaining bare helper call in an
-- RLS policy becomes `(select fn())`, so it is evaluated once per statement
-- instead of once per row. Same rule, same reasoning, same verification as
-- 0021 (its header has the measurements). NO semantic change: every expression
-- below is the current one, read from pg_policies on dev 2026-09-06, with the
-- calls wrapped. `alter policy`, so a wrong name fails loudly and rolls back.
--
-- Three tables also lose a REDUNDANT predicate, the same simplification 0023
-- made under shows: `x in (select id from t where t.organization_id =
-- my_organization_id())` becomes `x in (select id from t)`. The inner table is
-- itself RLS-filtered as the caller — every row it returns is already in the
-- caller's organization — so the org test was a second copy of a check the
-- subquery had already passed. Those are crew_call_positions (through rooms,
-- which since 0023 carry show_id and resolve in one level), payroll_rulesets
-- (through shows) and rate_cards (through crew_members). rate_cards' own SELECT
-- policy has used exactly this shape since it was written.
--
-- Deliberately untouched: policies with no helper call at all, and the
-- correlated EXISTS subqueries on organizations/profiles/show_assignments —
-- those reference the outer row, so they run per row by nature; only the
-- auth.uid()/my_organization_id() calls INSIDE them are wrapped here.

-- av_roles
alter policy "Users manage roles in their org" on public.av_roles
  using (organization_id = (select my_organization_id()))
  with check (organization_id = (select my_organization_id()));
alter policy "Users see roles in their org" on public.av_roles
  using (organization_id = (select my_organization_id()));

-- booking_invites
alter policy "Members see booking invites in their org" on public.booking_invites
  using (organization_id = (select my_organization_id()));
alter policy "Timecard editors create booking invites" on public.booking_invites
  with check (organization_id = (select my_organization_id()) and (select my_perm('can_edit_timecards')));
alter policy "Timecard editors update booking invites" on public.booking_invites
  using (organization_id = (select my_organization_id()) and (select my_perm('can_edit_timecards')));
alter policy "Timecard editors delete booking invites" on public.booking_invites
  using (organization_id = (select my_organization_id()) and (select my_perm('can_edit_timecards')));

-- clock_links
alter policy "Members see clock links in their org" on public.clock_links
  using (organization_id = (select my_organization_id()));
alter policy "Timecard editors create clock links" on public.clock_links
  with check (organization_id = (select my_organization_id()) and (select my_perm('can_edit_timecards')));
alter policy "Timecard editors update clock links" on public.clock_links
  using (organization_id = (select my_organization_id()) and (select my_perm('can_edit_timecards')));
alter policy "Timecard editors delete clock links" on public.clock_links
  using (organization_id = (select my_organization_id()) and (select my_perm('can_edit_timecards')));

-- crew_call_positions: one level through rooms (rooms.show_id since 0023).
-- The SELECT policy already reads `room_id in (select id from rooms)`.
alter policy "Users create call positions for their org shows" on public.crew_call_positions
  with check (room_id in (select id from rooms));
alter policy "Users update call positions for their org shows" on public.crew_call_positions
  using (room_id in (select id from rooms));
alter policy "Users delete call positions for their org shows" on public.crew_call_positions
  using (room_id in (select id from rooms));

-- invitations
alter policy "Admins can manage invitations" on public.invitations
  using (organization_id = (select my_organization_id()) and (select my_perm('can_manage_users')));

-- memberships
alter policy "Admins add members" on public.memberships
  with check (organization_id = (select my_organization_id()) and (select my_perm('can_manage_users')));
alter policy "Members see their org, admins see everyone" on public.memberships
  using (
    profile_id = (select auth.uid())
    or (organization_id = (select my_organization_id()) and (select my_perm('can_manage_users')))
  );
alter policy "Admins change members" on public.memberships
  using (organization_id = (select my_organization_id()) and (select my_perm('can_manage_users')))
  with check (organization_id = (select my_organization_id()) and (select my_perm('can_manage_users')));

-- organizations
alter policy "Users see organizations they belong to" on public.organizations
  using (exists (
    select 1 from memberships m
    where m.profile_id = (select auth.uid())
      and m.organization_id = organizations.id
      and m.deactivated_at is null
  ));
alter policy "org_admins_update_own_org" on public.organizations
  using (id = (select my_organization_id()) and (select my_perm('can_manage_users')))
  with check (id = (select my_organization_id()) and (select my_perm('can_manage_users')));

-- payroll_presets
alter policy "presets_select_own_org" on public.payroll_presets
  using (organization_id = (select my_organization_id()));
alter policy "presets_insert_own_org" on public.payroll_presets
  with check (organization_id = (select my_organization_id()) and (select my_perm('can_manage_rulesets')));
alter policy "presets_update_own_org" on public.payroll_presets
  using (organization_id = (select my_organization_id()) and (select my_perm('can_manage_rulesets')))
  with check (organization_id = (select my_organization_id()) and (select my_perm('can_manage_rulesets')));
alter policy "presets_delete_own_org" on public.payroll_presets
  using (organization_id = (select my_organization_id()) and (select my_perm('can_manage_rulesets')));

-- payroll_rulesets: one level through shows (the SELECT policy already is).
alter policy "Users create rulesets for their org shows" on public.payroll_rulesets
  with check (show_id in (select id from shows));
alter policy "Users update rulesets for their org shows" on public.payroll_rulesets
  using (show_id in (select id from shows));

-- profiles
alter policy "Users see profiles in their org" on public.profiles
  using (
    id = (select auth.uid())
    or exists (
      select 1 from memberships m
      where m.profile_id = profiles.id and m.organization_id = (select my_organization_id())
    )
  );
alter policy "Admins can manage org member permissions" on public.profiles
  using (
    (select my_perm('can_manage_users'))
    and exists (
      select 1 from memberships m
      where m.profile_id = profiles.id and m.organization_id = (select my_organization_id())
    )
  )
  with check (
    (select my_perm('can_manage_users'))
    and exists (
      select 1 from memberships m
      where m.profile_id = profiles.id and m.organization_id = (select my_organization_id())
    )
  );
alter policy "Users can update their own profile" on public.profiles
  using (id = (select auth.uid()));

-- rate_cards: one level through crew_members (the SELECT policy already is).
alter policy "Users create rate cards for their org crew" on public.rate_cards
  with check (crew_member_id in (select id from crew_members));
alter policy "Users update rate cards for their org crew" on public.rate_cards
  using (crew_member_id in (select id from crew_members));
alter policy "Users delete rate cards for their org crew" on public.rate_cards
  using (crew_member_id in (select id from crew_members));

-- show_assignments (the SELECT policy was done in 0021)
alter policy "Admins assign members to shows" on public.show_assignments
  with check (
    organization_id = (select my_organization_id())
    and (select my_perm('can_manage_users'))
    and exists (
      select 1 from memberships m
      where m.profile_id = show_assignments.profile_id
        and m.organization_id = (select my_organization_id())
    )
  );
alter policy "Admins revoke member show access" on public.show_assignments
  using (organization_id = (select my_organization_id()) and (select my_perm('can_manage_users')));

-- subscriptions
alter policy "Org members can see their subscription" on public.subscriptions
  using (organization_id = (select my_organization_id()));
alter policy "Only admins can update subscription" on public.subscriptions
  using (organization_id = (select my_organization_id()) and (select my_perm('can_manage_billing')));
