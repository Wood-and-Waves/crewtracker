-- Same rules as 0029, written so they cost what 0023 bought.
--
-- Measured on dev right after 0029: the app's punch read went 1.1 → 9.5 ms and
-- the harness admin read 10 → 42 ms. Two reasons, both shape, not meaning:
--
--   1. punches: `timecard_id in (select id from timecards)` re-derives EVERY
--      visible timecard for the whole organization on every punch read — the
--      chain-depth cost 0023 removed, put back.
--   2. timecards: `show_id in (select my_pm_show_ids())` runs the entire shows
--      visibility rule a second time, inside a function, per statement.
--
-- The fix is the shape 0021 established: the common case decided by a
-- once-per-statement InitPlan that short-circuits the rest. For anyone who can
-- see all shows (every admin, every office login) `(select can_see_all_shows())`
-- is true and the other arms are never evaluated — hashed subplans are built
-- lazily on first use. For an assigned PM the arms are two small lookups.
-- For a crew-side person the last arm is their own rows, which is tiny.
--
-- my_pm_show_ids() stays for the APP (isPmOnShow) and the unlock guard, where
-- it is called once. It is no longer used inside any policy.
--
-- Meaning is unchanged: PM-side = can_see_all_shows OR on the access list OR
-- created it OR its scheduler; crew-side = own rows only. rls.mts pins it.

alter policy "Users see timecards for their shows" on public.timecards
  using (
    show_id in (select id from shows)
    and (
      (select can_see_all_shows())
      or crew_member_id in (select my_crew_member_ids())
      or show_id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or show_id in (select id from shows where created_by = (select auth.uid()) or scheduler_id = (select auth.uid()))
    )
  );

alter policy "Users see punches for their timecards" on public.punches
  using (
    show_id in (select id from shows)
    and (
      (select can_see_all_shows())
      or show_id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or show_id in (select id from shows where created_by = (select auth.uid()) or scheduler_id = (select auth.uid()))
      or timecard_id in (select id from timecards where crew_member_id in (select my_crew_member_ids()))
    )
  );
