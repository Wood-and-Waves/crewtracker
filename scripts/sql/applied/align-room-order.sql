-- Make every day of a show list its rooms in the same order.
--
-- The tracker orders rooms by created_at (insertion order). AddDayButton used to
-- sort the source day's rooms alphabetically before cloning them, so a show whose
-- rooms were created "Lobby, GS" got new days ordered "GS, Lobby" — the columns
-- swapped places partway through the show, exactly where a PM is punching the
-- same crew day after day. The code no longer sorts; this repairs days already
-- created the old way.
--
-- Canonical order = the room-name order on the show's EARLIEST work day, which
-- is the order the PM originally set up. Every later day is re-stamped to match.
-- created_at on rooms is only ever used for display ordering, so rewriting it is
-- safe; nothing joins or filters on it.
--
-- Idempotent: re-running produces the same ordering.

begin;

with first_day as (
  -- The earliest work day per show
  select distinct on (show_id) show_id, id as work_day_id
  from work_days
  order by show_id, date, day_number
),
canonical as (
  -- The name order that day established
  select fd.show_id,
         r.name,
         row_number() over (partition by fd.show_id order by r.created_at, r.id) as position
  from first_day fd
  join rooms r on r.work_day_id = fd.work_day_id
),
target as (
  select r.id,
         coalesce(c.position, 999) as position,
         w.date
  from rooms r
  join work_days w on w.id = r.work_day_id
  left join canonical c on c.show_id = w.show_id and c.name = r.name
)
update rooms r
set created_at = (t.date::timestamptz + (t.position * interval '1 second'))
from target t
where r.id = t.id
  and r.created_at is distinct from (t.date::timestamptz + (t.position * interval '1 second'));

commit;

-- Verify: every day of every show should now list rooms in the same order.
select s.name as show, w.day_number,
       string_agg(r.name, ' | ' order by r.created_at, r.id) as room_order
from shows s
join work_days w on w.show_id = s.id
join rooms r on r.work_day_id = w.id
group by s.name, w.day_number, w.date
order by s.name, w.date;
