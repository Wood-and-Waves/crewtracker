-- Data-integrity sweep. Every check should return ZERO rows; anything listed is
-- a real problem. Safe to re-run any time, especially after a testing session —
-- half-finished manual testing is exactly what leaves this kind of debris.

-- 1. A crew member holding more than one rate for the same role on one show.
--    The show-wide day-rate triggers exist to make this impossible.
select 'split rate within a show' as check, s.name as show, t.crew_member_name, t.role,
       string_agg(distinct t.day_rate::text, ', ') as rates
from timecards t
join rooms r on r.id = t.room_id
join work_days w on w.id = r.work_day_id
join shows s on s.id = w.show_id
group by 1,2,3,4 having count(distinct t.day_rate) > 1;

-- 2. Duplicate crew in a room (the partial unique index should prevent it).
--    Group by room ID, not name: rooms are per-day, so the same name recurs on
--    every day of a show and grouping by name counts one person across the whole
--    run rather than twice in one room.
select 'duplicate crew in room' as check, r.name as room, t.crew_member_name, count(*)
from timecards t join rooms r on r.id = t.room_id
where t.crew_member_id is not null
group by r.id, r.name, t.crew_member_name, t.crew_member_id
having count(*) > 1;

-- 3. Orphans.
select 'room with no work day' as check, r.id::text
from rooms r left join work_days w on w.id = r.work_day_id where w.id is null;

select 'timecard with no room' as check, t.id::text
from timecards t left join rooms r on r.id = t.room_id where r.id is null;

select 'punch with no timecard' as check, p.id::text
from punches p left join timecards t on t.id = p.timecard_id where t.id is null;

select 'work day with no show' as check, w.id::text
from work_days w left join shows s on s.id = w.show_id where s.id is null;

-- 4. shows.end_date must agree with the last work day (Add Day used to advance
--    end_date in a separate write that could succeed while the rest failed).
select 'end_date disagrees with last work day' as check, s.name,
       to_char(s.end_date,'YYYY-MM-DD') as end_date,
       to_char(max(w.date),'YYYY-MM-DD') as last_day
from shows s join work_days w on w.show_id = s.id
group by s.id, s.name, s.end_date having s.end_date <> max(w.date);

-- 5. Duplicate dates within a show. Grouped by show ID: two different shows can
--    share a name (there are two called "Test 1", one per organization), and
--    grouping by name would compare them against each other.
select 'duplicate date in show' as check, s.name, to_char(w.date,'YYYY-MM-DD') as date, count(*)
from work_days w join shows s on s.id = w.show_id
group by s.id, s.name, w.date having count(*) > 1;

-- 6. Room ordering must be identical on every day of a show. Same name-vs-id
--    trap as above — comparing two same-named shows' room lists reports a
--    difference that isn't one.
select 'room order differs between days' as check, show_name, count(distinct room_order) as distinct_orders
from (
  select s.id as show_id, s.name as show_name, w.day_number,
         string_agg(r.name, '|' order by r.created_at, r.id) as room_order
  from shows s join work_days w on w.show_id = s.id join rooms r on r.work_day_id = w.id
  group by s.id, s.name, w.day_number
) x group by show_id, show_name having count(distinct room_order) > 1;

-- 7. Punches out of chronological order within a timecard.
select 'punch order violated' as check, t.crew_member_name,
       min(p.punched_at) as first_punch, max(p.punched_at) as last_punch
from punches p join timecards t on t.id = p.timecard_id
where p.punch_type = 'start'
  and exists (select 1 from punches p2 where p2.timecard_id = p.timecard_id
              and p2.punch_type = 'end' and p2.punched_at <= p.punched_at)
group by 1,2;

-- 8. Rates that survived the lockdown as nulls where a show rate exists —
--    a person on a show where others in the same role do have a rate.
select 'null rate despite a show rate for that role' as check,
       s.name as show, t.crew_member_name, t.role
from timecards t
join rooms r on r.id = t.room_id
join work_days w on w.id = r.work_day_id
join shows s on s.id = w.show_id
where t.day_rate is null
  and exists (
    select 1 from timecards t2
    join rooms r2 on r2.id = t2.room_id
    join work_days w2 on w2.id = r2.work_day_id
    where w2.show_id = w.show_id
      and t2.role is not distinct from t.role
      and t2.crew_member_id is not distinct from t.crew_member_id
      and t2.day_rate is not null
  );
