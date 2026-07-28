-- SECURITY FIX: the pay-rate views were still reading the legacy profiles column.
--
-- THE BUG
-- -------
-- Both rate views gated on
--     coalesce((select p.can_view_pay_rates from profiles p where p.id = auth.uid()), false)
-- rather than on my_perm('can_view_pay_rates'). Migration 0003 moved every
-- POLICY onto my_perm and these two views were missed, because they are views
-- rather than policies and nothing pointed at them.
--
-- While one login meant one organization that was merely untidy: the mirror kept
-- profiles in step with memberships, so the two agreed. Multi-organization broke
-- that, in a way easy to miss — **switching companies updates only
-- profiles.active_organization_id and touches no membership, so the mirror does
-- not re-run.** The column therefore keeps the PREVIOUS company's answer.
--
-- Demonstrated on dev: a person who is an admin with rate access at company A and
-- crew WITHOUT rate access at company B switches to B, and the view hands them
-- B's day rates. my_perm() correctly returned false at the same moment. So the
-- database's own answer and the view's answer disagreed, and the view won.
--
-- Nobody was exposed in production when this was found — the single multi-company
-- account had rate access at both — but it would have bitten the first real
-- multi-organization user, which is precisely who the feature is for.
--
-- CREATE OR REPLACE rather than DROP/CREATE: replacing preserves the grants,
-- and these views are the only route to a day rate for a permitted user. Dropping
-- them would silently take the column privileges with them.

-- Both keep security_invoker = false: they must run with the definer's rights to
-- read day_rate at all, since `authenticated` deliberately holds no SELECT on
-- that column. The permission check inside is what makes that safe.

create or replace view public.timecard_day_rates
with (security_invoker = false) as
  select t.id as timecard_id,
         w.show_id,
         t.day_rate
  from timecards t
  join rooms r on r.id = t.room_id
  join work_days w on w.id = r.work_day_id
  join shows s on s.id = w.show_id
  where s.organization_id = my_organization_id()
    and my_perm('can_view_pay_rates')
    and (
      can_see_all_shows()
      or s.created_by = auth.uid()
      or exists (
        select 1 from show_assignments sa
        where sa.show_id = s.id and sa.profile_id = auth.uid()
      )
    );

create or replace view public.crew_rate_cards_visible
with (security_invoker = false) as
  select rc.id,
         rc.crew_member_id,
         rc.role,
         rc.day_rate
  from rate_cards rc
  join crew_members cm on cm.id = rc.crew_member_id
  where cm.organization_id = my_organization_id()
    and my_perm('can_view_pay_rates');
