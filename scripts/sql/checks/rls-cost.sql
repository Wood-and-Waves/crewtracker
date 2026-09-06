-- RLS cost harness — READ ONLY. Safe on dev and production.
--
--   npm run db:sql -- scripts/sql/checks/rls-cost.sql
--   npm run db:sql -- --prod scripts/sql/checks/rls-cost.sql
--
-- Measures what the app actually pays for its hottest query and its hottest
-- write, as a real signed-in role with RLS enforced. `npm run db:sql` connects
-- as the owner, which BYPASSES RLS, so the `set local role authenticated` plus
-- a JWT claim below is what makes the numbers honest — the same trick
-- scripts/test/rls.mts uses.
--
-- The read is EXPLAIN ANALYZE (executes a SELECT; harmless). The write is plain
-- EXPLAIN — never executed — because its interesting signal is plan SHAPE:
-- whether my_perm()/my_organization_id() sit under `InitPlan` (evaluated once)
-- or inside a row `Filter:` (evaluated per row), and how many times `shows` is
-- scanned. Everything runs inside begin/rollback regardless.
--
-- Two passes: an admin (can_see_all_shows short-circuits the assignment
-- branch) and a non-admin PM (exercises show_assignments). If no such PM exists
-- the second pass reports it and its plans are for an anonymous session —
-- ignore them.
--
-- What to grep for:  "Execution Time"  "Planning Time"  "Seq Scan on shows"
--                    "InitPlan"  "my_perm("  "my_organization_id()"

-- ---------------------------------------------------------------- admin ---
begin;
select '=== PASS 1: ADMIN ===' as section;
select set_config('request.jwt.claims',
  (select json_build_object('sub', profile_id::text, 'role', 'authenticated')::text
     from memberships
    where base_role = 'admin' and deactivated_at is null
    order by created_at limit 1), true) as claims;
set local role authenticated;

select '=== READ: every punch on the biggest show ===' as section;
explain (analyze, buffers, summary, format text)
select * from punches
 where timecard_id in (
   select t.id from timecards t
   join rooms r on r.id = t.room_id
   join work_days w on w.id = r.work_day_id
   where w.show_id = (
     select w2.show_id
       from work_days w2
       join rooms r2 on r2.work_day_id = w2.id
       join timecards t2 on t2.room_id = r2.id
       join punches p2 on p2.timecard_id = t2.id
      group by w2.show_id order by count(p2.id) desc limit 1));

select '=== WRITE: one punch UPDATE (plan only, not executed) ===' as section;
explain (format text)
update punches set punched_at = punched_at
 where id = (
   select p.id from punches p
   join timecards t on t.id = p.timecard_id
   join rooms r on r.id = t.room_id
   join work_days w on w.id = r.work_day_id
   join shows s on s.id = w.show_id
   where s.finalized_at is null limit 1);
rollback;

-- ------------------------------------------------------- non-admin PM ---
begin;
select '=== PASS 2: NON-ADMIN PM (assignment branch) ===' as section;
select case when exists (
         select 1 from memberships
          where base_role = 'pm' and can_edit_all_shows = false and deactivated_at is null)
       then 'pm found' else 'NO non-admin PM in this database — pass 2 is anonymous, ignore it' end
       as note;
select set_config('request.jwt.claims',
  (select json_build_object('sub', profile_id::text, 'role', 'authenticated')::text
     from memberships
    where base_role = 'pm' and can_edit_all_shows = false and deactivated_at is null
    order by created_at limit 1), true) as claims;
set local role authenticated;

select '=== READ (pm) ===' as section;
explain (analyze, buffers, summary, format text)
select * from punches
 where timecard_id in (
   select t.id from timecards t
   join rooms r on r.id = t.room_id
   join work_days w on w.id = r.work_day_id
   where w.show_id = (
     select w2.show_id
       from work_days w2
       join rooms r2 on r2.work_day_id = w2.id
       join timecards t2 on t2.room_id = r2.id
       join punches p2 on p2.timecard_id = t2.id
      group by w2.show_id order by count(p2.id) desc limit 1));

select '=== WRITE (pm, plan only) ===' as section;
explain (format text)
update punches set punched_at = punched_at
 where id = (
   select p.id from punches p
   join timecards t on t.id = p.timecard_id
   join rooms r on r.id = t.room_id
   join work_days w on w.id = r.work_day_id
   join shows s on s.id = w.show_id
   where s.finalized_at is null limit 1);
rollback;
