-- Make "Add Day" atomic.
--
-- The client did four separate writes — extend shows.end_date, insert the
-- work_day, insert the cloned rooms, insert the copied timecards — with no
-- transaction around them. Any failure midway left a half-built day, and the
-- retry then hit `work_days_show_id_date_key`. That is exactly what happened
-- when the rate triggers briefly lost access to day_rate: the day and its rooms
-- were created, the crew copy failed, and "Add Day (Empty)" could no longer be
-- used because the date was taken.
--
-- A function body runs in a single transaction, so either the whole day appears
-- or none of it does.
--
-- SECURITY INVOKER (the default) on purpose: RLS still applies to every
-- statement, so this grants no privilege the caller didn't already have. It only
-- makes an existing sequence atomic. A definer-rights version would let anyone
-- who can call it extend any show.
--
-- Date arithmetic moved to SQL as well: `date + 1` on a date column has no
-- timezone in it at all, which removes the whole class of off-by-one-day bug
-- this project has hit repeatedly (see CLAUDE.md).

begin;

create or replace function add_show_day(
  p_show_id uuid,
  p_copy_crew boolean default false
)
returns table (
  work_day_id uuid,
  day_number int,
  day_date date,
  rooms_created int,
  crew_copied int
)
language plpgsql
set search_path = public
as $$
declare
  v_last work_days%rowtype;
  v_new  work_days%rowtype;
  v_rooms int := 0;
  v_crew  int := 0;
begin
  select * into v_last
  from work_days
  where show_id = p_show_id
  order by date desc, day_number desc
  limit 1;

  if v_last.id is null then
    raise exception 'This show has no days to extend.';
  end if;

  insert into work_days (show_id, date, day_number)
  values (p_show_id, v_last.date + 1, v_last.day_number + 1)
  returning * into v_new;

  -- Clone the rooms, preserving the source day's display order. Same created_at
  -- convention as scripts/sql/align-room-order.sql so ordering stays consistent
  -- however a day was created.
  insert into rooms (work_day_id, name, created_at)
  select v_new.id,
         r.name,
         v_new.date::timestamptz + (row_number() over (order by r.created_at, r.id)) * interval '1 second'
  from rooms r
  where r.work_day_id = v_last.id;
  get diagnostics v_rooms = row_count;

  if p_copy_crew then
    -- No day_rate: the BEFORE INSERT trigger inherits the show's rate for each
    -- (crew member, role). Matching rooms by name is what makes a roster carry
    -- across to the equivalent room on the new day.
    insert into timecards (room_id, crew_member_id, crew_member_name, role)
    select new_room.id, t.crew_member_id, t.crew_member_name, t.role
    from timecards t
    join rooms old_room on old_room.id = t.room_id
    join rooms new_room on new_room.work_day_id = v_new.id
                       and new_room.name = old_room.name
    where old_room.work_day_id = v_last.id;
    get diagnostics v_crew = row_count;
  end if;

  update shows
  set end_date = greatest(end_date, v_new.date)
  where id = p_show_id;

  return query select v_new.id, v_new.day_number, v_new.date, v_rooms, v_crew;
end;
$$;

revoke all on function add_show_day(uuid, boolean) from public, anon;
grant execute on function add_show_day(uuid, boolean) to authenticated;

commit;
