-- Timecard writes must check a PERMISSION, not just company membership.
--
-- The same hole 0019 closed on `punches`, found while fixing that one and left
-- for its own pass. The three write policies on `timecards` only ever asked
-- `shows.organization_id = my_organization_id()`, so anybody invited to an
-- organization could staff, unstaff, rename or delete a timecard on ANY show in
-- it — including a `view_only` member, and including shows hidden from them by
-- `show_assignments`.
--
-- Worse than the punch version in one respect: deleting a timecard removes
-- somebody from the day entirely, taking their punches with it (the FK
-- cascades). Not worse in another: `day_rate` was never exposed here, because
-- `enforce_pay_rate_write_permission` guards that column separately as a
-- trigger, and triggers are not policies.
--
-- SCOPE, as in 0019: delegate to `rooms` instead of joining `shows` directly,
-- so "can you see this show" is inherited from the existing chain
-- rooms → work_days → shows → show_assignments rather than reimplemented.
-- timecards → rooms never points back at timecards, so no RLS recursion.
--
-- PERMISSION: `can_edit_timecards`. A timecard IS the thing being created, and
-- all three role presets that staff shows (admin, staff, pm) already hold it,
-- so no ordinary setup changes behaviour. There is deliberately NO
-- `is_own_timecard` door here, unlike punches: staffing is a PM's decision, and
-- a crew member should never create or delete their own booking.
--
-- WATCH: `add_show_day` is NOT security definer, so it runs as the caller and
-- these policies apply to it. "Add Day" with copy-crew inserts timecards, and
-- that path is covered by a test in scripts/test/rls.mts for exactly that reason.

drop policy if exists "Users create timecards for their org shows" on public.timecards;
drop policy if exists "Users update timecards for their org shows" on public.timecards;
drop policy if exists "Users delete timecards for their org shows" on public.timecards;

create policy "Timecard editors create timecards"
  on public.timecards for insert
  with check (room_id in (select id from rooms) and my_perm('can_edit_timecards'));

create policy "Timecard editors update timecards"
  on public.timecards for update
  using (room_id in (select id from rooms) and my_perm('can_edit_timecards'));

create policy "Timecard editors delete timecards"
  on public.timecards for delete
  using (room_id in (select id from rooms) and my_perm('can_edit_timecards'));

-- SELECT untouched: it already delegates to `rooms` and is correctly scoped.
