-- A day is a SET of activities (Section A of the 2026-09-07 show-flow spec).
--
-- The eight compound day types (0015/0016) tried to name every combination
-- and could not be finished. From here a day carries any subset of
-- {travel, load_in, rehearsal, show, load_out}; the label and colour are
-- derived in lib/dayActivities.ts.
--
-- WRITES EXISTING ROWS: activities is backfilled from day_type for every
-- work day (no information lost — each of the eight maps to a set).
--
-- day_type STAYS, as a mirror kept true by a trigger in BOTH directions, so
-- the code deployed before this migration (which reads and writes day_type)
-- and the code deployed after (activities) agree during the gap, and a booking
-- email rendered by either shows the same text. A later migration drops it
-- once nothing reads it.
--
-- work_days UPDATE is COLUMN-granted (0015): the new column needs its own
-- grant, and the existing UPDATE policy ("Users set day type on their org
-- shows") already covers the row. Both halves, or the silent-success bug.

alter table public.work_days
  add column if not exists activities text[] not null default '{}';

alter table public.work_days drop constraint if exists work_days_activities_check;
alter table public.work_days add constraint work_days_activities_check
  check (activities <@ array['travel','load_in','rehearsal','show','load_out']::text[]);

grant update (activities) on public.work_days to authenticated;

-- The mapping, in SQL, matching lib/dayActivities.ts fromLegacy/toLegacy.
create or replace function public.day_type_to_activities(p text) returns text[]
language sql immutable as $$
  select case p
    when 'travel_load_in'  then array['travel','load_in']
    when 'load_in'         then array['load_in']
    when 'load_in_show'    then array['load_in','show']
    when 'rehearsal'       then array['rehearsal']
    when 'show'            then array['show']
    when 'show_load_out'   then array['show','load_out']
    when 'load_out_travel' then array['load_out','travel']
    when 'travel'          then array['travel']
    else '{}'::text[] end;
$$;

create or replace function public.activities_to_day_type(p text[]) returns text
language sql immutable as $$
  select case
    when p is null or cardinality(p) = 0 then null
    when cardinality(p) = 2 and p @> array['travel','load_in']  then 'travel_load_in'
    when cardinality(p) = 2 and p @> array['load_in','show']    then 'load_in_show'
    when cardinality(p) = 2 and p @> array['show','load_out']   then 'show_load_out'
    when cardinality(p) = 2 and p @> array['load_out','travel'] then 'load_out_travel'
    when cardinality(p) = 1 and p[1] in ('load_in','rehearsal','show','travel') then p[1]
    -- No compound name: the biggest activity that has a legacy slug. The
    -- legacy list never had a plain load_out, so load-out-only mirrors to null.
    when 'show' = any(p) then 'show'
    when 'rehearsal' = any(p) then 'rehearsal'
    when 'load_in' = any(p) then 'load_in'
    when 'travel' = any(p) then 'travel'
    else null end;
$$;

-- Backfill.
update public.work_days set activities = day_type_to_activities(day_type)
where cardinality(activities) = 0 and day_type is not null;

-- The mirror. Whichever side the statement changed wins; a statement that
-- changes both trusts activities.
create or replace function public.work_days_mirror_day_type() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(coalesce(new.activities, '{}')) = 0 and new.day_type is not null then
      new.activities := day_type_to_activities(new.day_type);
    else
      new.day_type := activities_to_day_type(new.activities);
    end if;
  else
    if new.activities is distinct from old.activities then
      new.day_type := activities_to_day_type(new.activities);
    elsif new.day_type is distinct from old.day_type then
      new.activities := day_type_to_activities(new.day_type);
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists work_days_mirror_day_type on public.work_days;
create trigger work_days_mirror_day_type before insert or update on public.work_days
  for each row execute function public.work_days_mirror_day_type();
