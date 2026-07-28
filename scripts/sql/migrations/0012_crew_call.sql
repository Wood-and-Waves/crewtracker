-- The crew call: what a show day NEEDS, not just who happens to be on it.
--
-- WHY
-- ---
-- Until now a show day could only say who was booked. There was no way to say
-- it is short — "8 crew" reads as finished whether the call was for 8 or for
-- 14. The schedule can currently only count ROOMS with nobody in them, which is
-- a real signal but a coarse one: a room with one person in it looks covered
-- even when the call is for four.
--
-- The shape follows how calls are actually written in this business: a list of
-- positions, by role, for a room on a day — one A1, one V1, two stagehands.
-- Rooms are already per-work-day, so a position hanging off a room is
-- automatically per-day, which is what the work needs (load-in is riggers and
-- stagehands, show day is the full complement, load-out is different again).
--
-- ONE ROW PER POSITION, not role + quantity. Two stagehands is two rows. That
-- way each position is individually filled or open — you can see WHICH one is
-- empty instead of doing arithmetic, and the person filling it attaches to that
-- specific row.

create table if not exists public.crew_call_positions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  role text not null,
  sort_order integer not null default 0,
  -- Per-position nuance: "client asked for Alex", "must be union". The
  -- scheduler's working notes live where the decision is made.
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index if not exists crew_call_positions_room_id_idx
  on public.crew_call_positions (room_id);

alter table public.crew_call_positions enable row level security;

-- ALL FOUR POLICIES IN THE SAME MIGRATION AS THE TABLE. rls_auto_enable
-- force-enables RLS on every new table, so a table shipped without policies is
-- one nobody can read or write — a silent, total failure that looks like a bug
-- in the feature. This schema has shipped SELECT-only tables before and had to
-- retrofit writes when a feature hit the wall; not repeating it.
--
-- Scoped through rooms exactly as `timecards` is, deliberately: a call position
-- should be visible and editable in precisely the places a timecard is, and
-- copying the neighbouring table's rule is how that stays true. This does NOT
-- risk the RLS recursion incident — that was two tables whose policies
-- referenced EACH OTHER. Nothing in rooms, work_days or shows references
-- crew_call_positions.
create policy "Users see call positions for their shows"
  on public.crew_call_positions for select
  using (room_id in (select rooms.id from public.rooms));

create policy "Users create call positions for their org shows"
  on public.crew_call_positions for insert
  with check (room_id in (
    select r.id from public.rooms r
    join public.work_days wd on wd.id = r.work_day_id
    join public.shows s on s.id = wd.show_id
    where s.organization_id = my_organization_id()));

create policy "Users update call positions for their org shows"
  on public.crew_call_positions for update
  using (room_id in (
    select r.id from public.rooms r
    join public.work_days wd on wd.id = r.work_day_id
    join public.shows s on s.id = wd.show_id
    where s.organization_id = my_organization_id()));

create policy "Users delete call positions for their org shows"
  on public.crew_call_positions for delete
  using (room_id in (
    select r.id from public.rooms r
    join public.work_days wd on wd.id = r.work_day_id
    join public.shows s on s.id = wd.show_id
    where s.organization_id = my_organization_id()));

grant select, insert, update, delete on public.crew_call_positions to authenticated;

-- ---------------------------------------------------------------------------
-- Filling a position, and the booking conversation
-- ---------------------------------------------------------------------------
--
-- `call_position_id` makes "filled" a FACT rather than a guess. The alternative
-- — matching a timecard's role text against a position's role text — breaks the
-- first time somebody is booked as "A2" against a position called "Audio 2".
--
-- ON DELETE SET NULL, not CASCADE: deleting a position from the call must never
-- delete a person's timecard. They may already have punches, which is payroll.
alter table public.timecards
  add column if not exists call_position_id uuid
    references public.crew_call_positions(id) on delete set null;

-- The booking conversation, as a state on the booking itself.
--
--   pencilled -> invited -> confirmed | declined
--
-- `pencilled` is the default and exists because of how the work actually
-- happens: whoever builds the show often pins a requested person to a position
-- WITHOUT contacting them, and the scheduler has to be able to tell "penned in"
-- from "already asked". Without that distinction people get asked twice or
-- never.
--
-- HARD RULE: booking_status answers "did they agree to this booking" and
-- NOTHING else. It is never read by lib/payroll.ts. A cancelled-day flag (with
-- its own contractual questions about notice-window pay) is a separate column
-- for a separate question, still undesigned. Keeping these apart is what stops
-- a scheduling state quietly deciding what somebody gets paid.
alter table public.timecards
  add column if not exists booking_status text not null default 'pencilled',
  add column if not exists booking_invited_at timestamptz,
  add column if not exists booking_responded_at timestamptz;

alter table public.timecards
  add constraint timecards_booking_status_check
  check (booking_status in ('pencilled', 'invited', 'confirmed', 'declined'));

-- Existing rows are people who actually worked; calling them 'pencilled' would
-- render every past show as though nobody had ever been asked.
update public.timecards set booking_status = 'confirmed';

-- A DECLINED PERSON DOES NOT HOLD THE POSITION.
--
-- This is the rule that keeps the schedule honest: if a decline left someone
-- attached, the day would still read as covered when nobody is coming. The
-- partial index enforces it in the database rather than trusting every future
-- write path to remember — one live occupant per position, while any number of
-- declined rows may remain beside it.
--
-- The declined row is KEPT on purpose. It records that we asked and they said
-- no, which is what stops the scheduler working back down the same list next
-- week, and it is why the constraint excludes rather than deletes.
create unique index if not exists timecards_one_live_fill_per_position
  on public.timecards (call_position_id)
  where call_position_id is not null and booking_status <> 'declined';

-- The unique index above covers live fills only, so declined rows still need a
-- way to be found when showing a position's history.
create index if not exists timecards_call_position_idx
  on public.timecards (call_position_id);

-- COLUMN GRANTS — the step that is easy to miss and fails loudly but obscurely.
-- `authenticated` holds NO table-level SELECT on timecards, only per-column
-- grants (that is what keeps day_rate unreadable). A new column therefore
-- arrives with no privilege at all, and every query naming it returns 42501 for
-- every user including admins.
--
-- Re-run `npm run db:grants` after this reaches production, or scripts/sql/
-- grants.sql silently loses these.
grant select (call_position_id, booking_status, booking_invited_at, booking_responded_at)
  on public.timecards to authenticated;
grant insert (call_position_id, booking_status, booking_invited_at, booking_responded_at)
  on public.timecards to authenticated;
grant update (call_position_id, booking_status, booking_invited_at, booking_responded_at)
  on public.timecards to authenticated;

-- ---------------------------------------------------------------------------
-- A finalized show's call is read-only too
-- ---------------------------------------------------------------------------
--
-- block_writes_when_finalized branches on tg_table_name and treats anything
-- that is not 'timecards' as punches — resolving the room via new.timecard_id,
-- a column crew_call_positions does not have. Attaching the trigger unchanged
-- would fail at runtime with a confusing error, so the branch is widened to the
-- tables that carry room_id directly. Behaviour for timecards and punches is
-- unchanged.
create or replace function public.block_writes_when_finalized()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_room_id uuid;
  v_finalized timestamptz;
begin
  -- Resolve the room, whichever table fired and whichever direction.
  if tg_table_name in ('timecards', 'crew_call_positions') then
    if tg_op = 'DELETE' then v_room_id := old.room_id; else v_room_id := new.room_id; end if;
  else -- punches
    select t.room_id into v_room_id
    from timecards t
    where t.id = case when tg_op = 'DELETE' then old.timecard_id else new.timecard_id end;
  end if;

  select s.finalized_at into v_finalized
  from rooms r
  join work_days wd on wd.id = r.work_day_id
  join shows s on s.id = wd.show_id
  where r.id = v_room_id;

  if v_finalized is not null then
    raise exception
      'This show was finalized on % and its times are read-only. An admin can unlock it.',
      to_char(v_finalized, 'YYYY-MM-DD')
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;

create trigger block_call_positions_when_finalized
  before insert or update or delete on public.crew_call_positions
  for each row execute function public.block_writes_when_finalized();
