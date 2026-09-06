-- Indexes on the columns the RLS policies filter by.
--
-- HONEST EXPECTATION: at today's size (6 shows, 2 show_assignments, 5
-- memberships in production) the planner will keep choosing sequential scans
-- and these change NO plan measurably. They exist so that the policy
-- predicates stop being O(table) — every chain terminates in
-- `shows.organization_id = ...` and the assignment branch in
-- `show_assignments.profile_id = auth.uid()`, neither of which was indexed —
-- and so that foreign-key cascades stop seq-scanning as organizations
-- accumulate history. The measurable win is 0021; this is the floor under it.
--
-- 0011 indexed the app's downward joins (show → days → rooms → timecards →
-- punches) and its own header explains it stopped there. The policies walk the
-- same chain UPWARD and terminate on columns 0011 never touched.
--
-- Plain CREATE INDEX, not CONCURRENTLY: 470 rows hold a SHARE lock for
-- milliseconds, and CONCURRENTLY would force `-- migrate:no-transaction` and
-- forfeit rollback-on-failure. Same call 0011 made, same reasoning.

-- The two that every chain terminates on.
create index if not exists shows_organization_id_idx         on public.shows (organization_id);
-- (profile_id, show_id): the existing UNIQUE is (show_id, profile_id), whose
-- leading column is useless for the policy's `profile_id = auth.uid()` lookup.
-- Index-only for the `id in (select show_id from show_assignments where ...)` arm.
create index if not exists show_assignments_profile_show_idx on public.show_assignments (profile_id, show_id);

-- Other policy predicates.
create index if not exists shows_created_by_idx              on public.shows (created_by);
create index if not exists show_assignments_org_idx          on public.show_assignments (organization_id);
create index if not exists crew_members_organization_id_idx  on public.crew_members (organization_id);

-- Foreign keys with no index: every cascade and every `on delete set null`
-- otherwise scans the child table.
create index if not exists rate_cards_crew_member_idx        on public.rate_cards (crew_member_id);
create index if not exists punches_created_by_idx            on public.punches (created_by);
create index if not exists punches_source_link_idx           on public.punches (source_link);
create index if not exists clock_links_org_idx               on public.clock_links (organization_id);
create index if not exists clock_links_created_by_idx        on public.clock_links (created_by);
create index if not exists booking_invites_org_idx           on public.booking_invites (organization_id);
create index if not exists booking_invites_sent_by_idx       on public.booking_invites (sent_by);
