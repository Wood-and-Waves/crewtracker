-- Stage 3 of the day_rate lockdown: make can_view_pay_rates a real boundary.
--
-- Until now that permission was a UI convention. It appeared in no policy, and
-- any signed-in user could read every crew day rate straight from the REST API
-- regardless of it. This is the change that stops that.
--
-- HOW, AND WHY IT LOOKS LIKE THIS
-- -------------------------------
-- Every signed-in user shares one Postgres role, `authenticated`. Column
-- privileges are per-role, so they cannot distinguish an admin from a PM —
-- revoking day_rate removes it from EVERYONE. That is intended: the only path
-- to a rate becomes the permission-checked views from Stage 2
-- (scripts/sql/rate-views.sql), which are owned by postgres, retain their own
-- access, and check can_view_pay_rates for the calling user on every query.
--
-- `authenticated` currently holds TABLE-level SELECT, which a column revoke
-- would not override — so the table grant is dropped and every column except
-- day_rate is granted back explicitly.
--
-- Consequence worth knowing: `select('*')` on these tables now FAILS for
-- authenticated rather than silently omitting the column. Every such call site
-- was migrated first. The Final Report route is unaffected — it uses the
-- service role, which keeps full access.
--
-- SCOPE: reads only. INSERT/UPDATE on day_rate are deliberately left alone here
-- so this step is about disclosure and can be reasoned about on its own.
-- Gating writes on can_edit_pay_rates is Stage 4.
--
-- TO ROLL BACK: grant select on timecards, rate_cards to authenticated;

begin;

-- ---------------------------------------------------------------------------
-- timecards
-- ---------------------------------------------------------------------------

revoke select on timecards from authenticated;
grant select (
  id,
  room_id,
  crew_member_id,
  crew_member_name,
  role,
  is_travel_day,
  travel_in_day,
  travel_out_day,
  pay_as_half_day,
  created_at,
  updated_at
) on timecards to authenticated;

-- ---------------------------------------------------------------------------
-- rate_cards
-- ---------------------------------------------------------------------------

revoke select on rate_cards from authenticated;
grant select (
  id,
  crew_member_id,
  role,
  created_at
) on rate_cards to authenticated;

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
-- Row-level security already returns nothing to an unauthenticated caller
-- (verified against the live API), so this removes no working access — it
-- removes surface area that only exists because Supabase grants it by default.
-- Nothing anonymous has any business touching crew pay or timecards.

revoke all on timecards  from anon;
revoke all on rate_cards from anon;

commit;
