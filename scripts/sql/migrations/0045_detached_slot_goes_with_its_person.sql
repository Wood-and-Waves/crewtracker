-- A detached slot exists only for the person in it, and leaves with them.
--
-- Found on production 2026-10-09 (TxDOT Breakouts): Dan added a Production
-- Manager definition, booked himself, deleted the definition, then removed
-- himself — and five open "Production Manager" slots stayed on the Scheduling
-- screen with no screen able to delete them. Edit Show lists DEFINITIONS and
-- the tracker lists TIMECARDS; the grid draws every SLOT.
--
-- Why they survived: 0037's BEFORE DELETE trigger drops a definition's
-- UNFILLED slots only, and the FK then sets position_def_id null on the filled
-- ones — "never remove a booked person", the one rule. That is still right.
-- What was missing is the other half: a slot with no definition
-- (position_def_id null — detached by that delete, or by Keep on a flagged
-- booking) has no reason to exist except the person holding it. When that
-- person's timecard is deleted and nobody live is left on the slot, the slot
-- goes too. A slot that still belongs to a definition is untouched — the sync
-- owns those, and an open one is a position somebody asked for.
--
-- Runs as the caller (no SECURITY DEFINER): the slot DELETE policy asks only
-- that the room be visible, which anyone deleting a timecard on it satisfies.
--
-- WRITES EXISTING ROWS: deletes every open detached slot that exists today,
-- since under this rule none can. Production: exactly the five on TxDOT
-- Breakouts (verified read-only before writing; every other show had none).

create or replace function public.timecards_drop_detached_slot() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.call_position_id is null then return old; end if;
  delete from crew_call_positions p
  where p.id = old.call_position_id
    and p.position_def_id is null
    and not exists (
      select 1 from timecards t
      where t.call_position_id = p.id and t.id <> old.id
        and t.booking_status is distinct from 'declined');
  return old;
end; $$;

drop trigger if exists timecards_drop_detached_slot on public.timecards;
create trigger timecards_drop_detached_slot after delete on public.timecards
  for each row execute function public.timecards_drop_detached_slot();

-- The ones already orphaned.
delete from crew_call_positions p
where p.position_def_id is null
  and not exists (
    select 1 from timecards t
    where t.call_position_id = p.id and t.booking_status is distinct from 'declined');
