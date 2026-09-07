-- Changing a day (its activities, and the mirrored day_type) requires
-- can_edit_timecards — the same permission the shows UPDATE policy asks for.
--
-- Found by the 0032 checks: the work_days UPDATE policy from 0015 tested only
-- that the show was visible, so a view-only member could retag any day of any
-- show they could see. Pre-existing; closed here. Same shape as the shows
-- policy, helper wrapped as an InitPlan (0021).
alter policy "Users set day type on their org shows" on public.work_days
  using (show_id in (select id from shows) and (select my_perm('can_edit_timecards')))
  with check (show_id in (select id from shows) and (select my_perm('can_edit_timecards')));
