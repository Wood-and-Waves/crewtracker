-- Punch writes must check a PERMISSION, not just company membership.
--
-- THE HOLE THIS CLOSES
-- --------------------
-- The three write policies on `punches` only ever asked
-- `shows.organization_id = my_organization_id()` — "are you in this company?"
-- They never asked whether the caller may edit timecards, and never asked
-- whether the caller can even SEE the show. So anybody invited to an
-- organization could change the hours people get paid for, including a
-- `view_only` member, and including on shows hidden from them by
-- `show_assignments`. The app hides those controls, so this was never
-- reachable by accident — but the database did not stop a direct REST call.
--
-- Pre-dates the crew clock; that feature only made it visible by adding a
-- second write path into the table.
--
-- HOW THE SCOPE IS FIXED
-- ----------------------
-- Stop joining `shows` directly and delegate to `timecards`, exactly as the
-- SELECT policy on this table already does. `timecards`' own SELECT policy
-- chains rooms → work_days → shows, so "can you see this show" is inherited
-- rather than reimplemented — including the assignment-scoped rule that the
-- old org-only join skipped. No cycle: punches → timecards → rooms →
-- work_days → shows → show_assignments never points back at punches, so this
-- does not hit Postgres's RLS recursion guard (see CLAUDE.md).
--
-- The service role is unaffected: it bypasses RLS entirely, which is how
-- app/api/clock/punch writes crew punches. That route does its own
-- authorization with an unguessable token and its own rule checks.

-- The second door, for crew logins.
--
-- Deliberately returns FALSE today. `crew_members` has no link to an auth
-- user, and one must NEVER be inferred by matching email/phone/name — that is
-- precisely the cross-organization identity leak CLAUDE.md forbids, and it
-- would surface the moment one human worked for two companies.
--
-- When a real per-organization link between a login and a crew_members row
-- exists, THIS is the single place to implement it, and the policies below
-- start honouring it with no further change. Written now so the rule is
-- already the right shape rather than needing to be reopened.
create or replace function public.is_own_timecard(p_timecard_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select false;
$$;

comment on function public.is_own_timecard(uuid) is
  'Placeholder for crew logins: is this timecard the caller''s own? Always false until crew_members gains a per-org link to an auth user. Never match on email — that leaks identity across organizations.';

-- Rewritten in place. Dropping first because a policy cannot be ALTERed to a
-- new expression, and leaving the old one alongside would OR the hole back in:
-- Postgres permits a write if ANY policy for that command allows it.
drop policy if exists "Users create punches for their org timecards" on public.punches;
drop policy if exists "Users update punches for their org timecards" on public.punches;
drop policy if exists "Users delete punches for their org timecards" on public.punches;

create policy "Timecard editors create punches"
  on public.punches for insert
  with check (
    timecard_id in (select id from timecards)
    and (my_perm('can_edit_timecards') or is_own_timecard(timecard_id))
  );

create policy "Timecard editors update punches"
  on public.punches for update
  using (
    timecard_id in (select id from timecards)
    and (my_perm('can_edit_timecards') or is_own_timecard(timecard_id))
  );

create policy "Timecard editors delete punches"
  on public.punches for delete
  using (
    timecard_id in (select id from timecards)
    and (my_perm('can_edit_timecards') or is_own_timecard(timecard_id))
  );

-- SELECT is deliberately untouched: it already delegates to `timecards` and so
-- is already correctly scoped. Reading punches on a show you can see is fine.
