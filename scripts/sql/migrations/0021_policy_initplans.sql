-- Hoist RLS helper calls into once-per-statement InitPlans.
--
-- WHY THE APP GOT SLOW
-- --------------------
-- Measured 2026-09-06 on production: reading one show's 402 punches as a
-- signed-in admin cost ~50 ms (17 ms planning + 33 ms execution) against a
-- 0.27 ms floor with RLS off, and the plan scanned `shows` FIVE times. Not I/O:
-- a policy term that contains a column reference is a per-row filter, so
-- `organization_id = my_organization_id()` invoked the helper once per shows
-- row, in each copy of the shows scan, in every level of the chain
-- punches → timecards → rooms → work_days → shows → show_assignments. Roughly
-- seventy helper calls per statement, each a query over memberships.
--
-- THE REGRESSION 0019 ADDED (2026-09-05)
-- --------------------------------------
-- `my_perm('can_edit_timecards') or is_own_timecard(timecard_id)`: the OR
-- contains a column, so the whole OR is per-row, so my_perm (non-inlinable
-- plpgsql, two queries) ran per row — and a single punch UPDATE walked the full
-- chain three times (row lookup, USING, implied WITH CHECK). Punching got
-- visibly slower the day it shipped. This file reverses that.
--
-- THE FIX
-- -------
-- Wrap every helper call as `(select fn())`. Postgres turns an uncorrelated
-- scalar subquery into an InitPlan evaluated ONCE per statement and referenced
-- as a parameter. Verified by EXPLAIN on this server (Postgres 17.6): the call
-- moves from `Filter:` to `InitPlan`. `($1 OR is_own_timecard(timecard_id))`
-- still short-circuits, so the crew-login second door is untouched.
--
-- NO SEMANTIC CHANGE. Every expression below is the current one (read from
-- pg_policies on dev, 2026-09-06, not from the stale schema.sql) with calls
-- wrapped. The helpers never return NULL where they returned a value, so
-- `(select my_perm(...))` denies exactly where my_perm(...) did.
--
-- ALTER, not DROP/CREATE: a wrong policy name fails loudly and the transaction
-- rolls back, instead of silently leaving a hole open.

-- shows: the root of every chain. Text is the 0013 version (with scheduler_id).
alter policy "Users see their org shows" on public.shows
  using (
    organization_id = (select my_organization_id())
    and (
      (select can_see_all_shows())
      or id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or created_by = (select auth.uid())
      or scheduler_id = (select auth.uid())
    )
  );

alter policy "Users can update shows they can see" on public.shows
  using (
    organization_id = (select my_organization_id())
    and (select my_perm('can_edit_timecards'))
    and (
      (select can_see_all_shows())
      or id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or created_by = (select auth.uid())
    )
  )
  with check (organization_id = (select my_organization_id()));

alter policy "Users can create shows if permitted" on public.shows
  with check (
    organization_id = (select my_organization_id())
    and (select my_perm('can_create_shows'))
  );

alter policy "Users see their own assignments" on public.show_assignments
  using (
    organization_id = (select my_organization_id())
    and (profile_id = (select auth.uid()) or (select can_see_all_shows()))
  );

-- punches (0019). The OR is what made my_perm a per-row call.
alter policy "Timecard editors create punches" on public.punches
  with check (
    timecard_id in (select id from timecards)
    and ((select my_perm('can_edit_timecards')) or is_own_timecard(timecard_id))
  );

alter policy "Timecard editors update punches" on public.punches
  using (
    timecard_id in (select id from timecards)
    and ((select my_perm('can_edit_timecards')) or is_own_timecard(timecard_id))
  );

alter policy "Timecard editors delete punches" on public.punches
  using (
    timecard_id in (select id from timecards)
    and ((select my_perm('can_edit_timecards')) or is_own_timecard(timecard_id))
  );

-- timecards (0020)
alter policy "Timecard editors create timecards" on public.timecards
  with check (room_id in (select id from rooms) and (select my_perm('can_edit_timecards')));

alter policy "Timecard editors update timecards" on public.timecards
  using (room_id in (select id from rooms) and (select my_perm('can_edit_timecards')));

alter policy "Timecard editors delete timecards" on public.timecards
  using (room_id in (select id from rooms) and (select my_perm('can_edit_timecards')));

-- crew_members: read on every tracker load; same per-row shape.
alter policy "Users see crew in their org" on public.crew_members
  using (organization_id = (select my_organization_id()));

alter policy "Users can manage crew if permitted" on public.crew_members
  using (
    organization_id = (select my_organization_id())
    and (select my_perm('can_manage_crew_directory'))
  );

-- The two SECURITY DEFINER views bypass RLS on their base tables, so their cost
-- is the helper calls in their own WHERE, evaluated per shows row. Same fix.
-- CREATE OR REPLACE keeps the views' grants; the column lists are unchanged
-- (verified against information_schema before writing this).
create or replace view public.timecard_day_rates with (security_invoker = false) as
  select t.id as timecard_id, w.show_id, t.day_rate
  from timecards t
  join rooms r on r.id = t.room_id
  join work_days w on w.id = r.work_day_id
  join shows s on s.id = w.show_id
  where s.organization_id = (select my_organization_id())
    and (select my_perm('can_view_pay_rates'))
    and (
      (select can_see_all_shows())
      or s.created_by = (select auth.uid())
      or exists (select 1 from show_assignments sa
                  where sa.show_id = s.id and sa.profile_id = (select auth.uid()))
    );

create or replace view public.crew_rate_cards_visible with (security_invoker = false) as
  select rc.id, rc.crew_member_id, rc.role, rc.day_rate
  from rate_cards rc
  join crew_members cm on cm.id = rc.crew_member_id
  where cm.organization_id = (select my_organization_id())
    and (select my_perm('can_view_pay_rates'));

-- Deliberately untouched here: the SELECT policies on punches/timecards/rooms/
-- work_days (they contain no helper calls — their cost is the chain depth,
-- which 0023 flattens), and the ~25 policies on other tables (a mechanical
-- sweep for a later file once this one is proven on production).
