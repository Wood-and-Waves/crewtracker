-- Two gaps Dan found on the preview (2026-09-07) with positions by kind:
--
-- 1. Changing a definition's ROLE left its slots carrying the old role. The
--    sync counted slots per definition and never looked at the role, so an
--    "A1" added by mistake and corrected to "L1" still showed A1 on every day.
-- 2. Removing a definition left its EMPTY slots behind. The FK sets
--    position_def_id to NULL first, so by the time the sync ran the slots had
--    become "legacy" slots it deliberately leaves alone — and the show kept
--    counting a position nobody meant to keep.
--
-- The role now follows the definition on every slot (a booked person's own
-- timecard role is theirs and is not touched), and a BEFORE DELETE trigger on
-- position_defs removes that definition's UNFILLED slots before the FK can
-- orphan them. A filled slot keeps its person and becomes a one-off, as before.
-- SECURITY INVOKER throughout: the caller's crew_call_positions policies decide.
-- Writes NO existing rows by itself.

create or replace function public.sync_position_slots(p_show_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  d public.position_defs%rowtype;
  r record;
  have integer;
begin
  for d in select * from position_defs where show_id = p_show_id loop
    -- The role follows the definition.
    update crew_call_positions set role = d.role
      where position_def_id = d.id and role is distinct from d.role;
    -- Wanted room-days: top up to count.
    for r in
      select rm.id as room_id
      from rooms rm join work_days wd on wd.id = rm.work_day_id
      where wd.show_id = p_show_id and rm.name = d.room_name
        and position_def_wants(d.day_kind, d.custom_dates, wd.activities, wd.date)
    loop
      select count(*) into have from crew_call_positions where position_def_id = d.id and room_id = r.room_id;
      if have < d.count then
        insert into crew_call_positions (room_id, role, sort_order, position_def_id, created_by)
        select r.room_id, d.role, d.sort_order, d.id, auth.uid() from generate_series(1, d.count - have);
      elsif have > d.count then
        -- Too many: drop UNFILLED extras only.
        delete from crew_call_positions p
        where p.id in (
          select p2.id from crew_call_positions p2
          where p2.position_def_id = d.id and p2.room_id = r.room_id
            and not exists (select 1 from timecards t where t.call_position_id = p2.id and t.booking_status is distinct from 'declined')
          order by p2.created_at desc limit (have - d.count));
      end if;
    end loop;
    -- Unwanted room-days: drop UNFILLED slots. Filled ones stay and show as flags.
    delete from crew_call_positions p
    where p.position_def_id = d.id
      and not exists (select 1 from timecards t where t.call_position_id = p.id and t.booking_status is distinct from 'declined')
      and not exists (
        select 1 from rooms rm join work_days wd on wd.id = rm.work_day_id
        where rm.id = p.room_id and rm.name = d.room_name
          and position_def_wants(d.day_kind, d.custom_dates, wd.activities, wd.date));
  end loop;
end; $$;

create or replace function public.position_defs_drop_unfilled_slots() returns trigger
language plpgsql set search_path = public as $$
begin
  delete from crew_call_positions p
  where p.position_def_id = old.id
    and not exists (select 1 from timecards t where t.call_position_id = p.id and t.booking_status is distinct from 'declined');
  return old;
end; $$;
drop trigger if exists position_defs_drop_unfilled_slots on public.position_defs;
create trigger position_defs_drop_unfilled_slots before delete on public.position_defs
  for each row execute function public.position_defs_drop_unfilled_slots();
