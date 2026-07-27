-- Stage 2 of the day_rate lockdown: a permission-checked way to read pay rates
-- that will still work once Stage 3 revokes the column from `authenticated`.
--
-- WHY A VIEW AND NOT AN RLS POLICY
-- --------------------------------
-- Every signed-in user shares ONE Postgres role: `authenticated`. Column
-- privileges are granted per role, so they cannot distinguish an admin from a
-- PM — revoking `day_rate` from `authenticated` removes it from everybody.
-- RLS is row-level and can't hide a single column either. The only mechanism
-- that can say "this column, for this user, right now" is code that runs with
-- someone else's privileges and checks the caller itself.
--
-- These views are owned by postgres and deliberately NOT security_invoker, so
-- they keep their own read access to day_rate after Stage 3. That also means
-- they bypass the underlying tables' RLS, so every scoping rule the tables
-- would have applied has to be restated here explicitly. Getting that wrong
-- would leak across organizations, so the WHERE clauses below are the whole
-- security boundary and are tested as such.
--
-- Keyed by timecard id so callers can fetch timecards as they already do and
-- merge rates in by id, rather than restructuring every payroll call site.

begin;

-- ---------------------------------------------------------------------------
-- Per-timecard rates
-- ---------------------------------------------------------------------------

drop view if exists public.timecard_day_rates;
create view public.timecard_day_rates
with (security_invoker = false)
as
select
  t.id as timecard_id,
  w.show_id,
  t.day_rate
from timecards t
join rooms r     on r.id = t.room_id
join work_days w on w.id = r.work_day_id
join shows s     on s.id = w.show_id
where
  -- 1. same organization as the caller
  s.organization_id = my_organization_id()
  -- 2. the caller is allowed to see pay rates at all
  and coalesce((select p.can_view_pay_rates from profiles p where p.id = auth.uid()), false)
  -- 3. and can see THIS show — the same rule shows' own SELECT policy uses.
  --    Restated because a non-invoker view bypasses that policy entirely.
  and (
    can_see_all_shows()
    or s.created_by = auth.uid()
    or exists (
      select 1 from show_assignments sa
      where sa.show_id = s.id and sa.profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Directory rate cards
-- ---------------------------------------------------------------------------
-- No per-show visibility rule here: rate cards belong to the crew directory,
-- which is org-wide.

drop view if exists public.crew_rate_cards_visible;
create view public.crew_rate_cards_visible
with (security_invoker = false)
as
select
  rc.id,
  rc.crew_member_id,
  rc.role,
  rc.day_rate
from rate_cards rc
join crew_members cm on cm.id = rc.crew_member_id
where
  cm.organization_id = my_organization_id()
  and coalesce((select p.can_view_pay_rates from profiles p where p.id = auth.uid()), false);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- authenticated only. `anon` is deliberately not granted: nothing
-- unauthenticated has any business reading pay rates, and the existing anon
-- grants on the base tables are attack surface Stage 3 removes.

grant select on public.timecard_day_rates      to authenticated;
grant select on public.crew_rate_cards_visible to authenticated;

revoke all on public.timecard_day_rates      from anon;
revoke all on public.crew_rate_cards_visible from anon;

commit;
