-- timecard_day_rates learns the scheduler_id arm of the shows policy.
--
-- 0013 gave the shows SELECT policy a fourth way to see a show: being its
-- scheduler (`scheduler_id = auth.uid()`). The timecard_day_rates view is
-- SECURITY DEFINER — it bypasses RLS on its base tables so it can hand out
-- day_rate, a column the caller cannot read directly — which means it carries
-- its OWN copy of "which shows can this person see", and that copy was never
-- updated. Result: a scheduler who holds can_view_pay_rates got no rates on a
-- show they were handed but did not create and are not assigned to. Found by
-- the 2026-09-06 speed review; pre-existing; recorded in CLAUDE.md.
--
-- Same four arms as the shows policy now, in the same order, helper calls
-- wrapped as 0021 left them. CREATE OR REPLACE keeps the view's grants; the
-- column list is unchanged. The permission test (can_view_pay_rates) is
-- untouched — this widens WHICH shows, never WHO.
--
-- If the shows policy ever gains a fifth arm, this view needs it too. That is
-- the cost of a SECURITY DEFINER view, and why CLAUDE.md says so.

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
      or exists (select 1 from show_assignments sa
                  where sa.show_id = s.id and sa.profile_id = (select auth.uid()))
      or s.created_by = (select auth.uid())
      or s.scheduler_id = (select auth.uid())
    );
