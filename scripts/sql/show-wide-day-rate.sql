-- A crew member's day rate is a property of the SHOW, not of an individual day.
--
-- The rate is stored per-timecard (one row per person per room per day), which
-- let three different write paths disagree:
--   * Edit Show -> Crew & Rates already updated every day of the show (correct)
--   * RoomActionsMenu "Edit crew" updated ONE timecard (the divergence source)
--   * StaffRoomModal inserted the crew member's DIRECTORY rate, which diverges
--     if someone is staffed onto later days after that directory rate changed
--
-- Rather than restructure the rate out of `timecards` -- which would ripple
-- through lib/payroll.ts (the line-by-line-verified iOS port), both exports,
-- the reports page and the timesheet builder -- the invariant is enforced here.
-- Reads are completely unchanged; the column simply can no longer diverge, on
-- any write path, including ones added later.
--
-- Same pattern as show_assignments.organization_id: denormalized value kept
-- honest by a trigger (see CLAUDE.md "Past incidents").
--
-- The rate is keyed on (show, crew member, role) -- NOT (show, crew member).
-- One person legitimately holds different rates in different roles on the same
-- show (Hal works Test 2 as both A1 and L1), and reports already group on
-- name|role. Role-scoping gives "constant across all days" without collapsing
-- that.
--
-- Crew with no directory record (crew_member_id IS NULL) are matched on
-- crew_member_name, mirroring what EditShowClient.commitRateEdit already does.

begin;

-- ---------------------------------------------------------------------------
-- 1. Repair existing divergence: highest rate wins.
-- ---------------------------------------------------------------------------
-- Two groups exist at time of writing (Hal/A1 on Test 1 at 500 & 650, Roger on
-- Test 2 at 0 & 500). Highest wins on the assumption that the larger figure was
-- the correction and a 0 was an unset default.

with scoped as (
  select t.id, t.day_rate, t.role, t.crew_member_id, t.crew_member_name,
         w.show_id
  from timecards t
  join rooms r on r.id = t.room_id
  join work_days w on w.id = r.work_day_id
),
target as (
  select show_id, role, crew_member_id, crew_member_name,
         max(day_rate) as winning_rate
  from scoped
  group by show_id, role, crew_member_id, crew_member_name
  having count(distinct day_rate) > 1
)
update timecards t
set day_rate = tg.winning_rate
from scoped s
join target tg
  on tg.show_id = s.show_id
 and tg.role is not distinct from s.role
 and tg.crew_member_id is not distinct from s.crew_member_id
 and tg.crew_member_name is not distinct from s.crew_member_name
where t.id = s.id
  and t.day_rate is distinct from tg.winning_rate;

-- ---------------------------------------------------------------------------
-- 2. Helper: which show does a timecard belong to?
-- ---------------------------------------------------------------------------
-- timecards reach a show only via rooms -> work_days, so both triggers need
-- this two-hop lookup.

create or replace function show_id_for_room(p_room_id uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  select w.show_id
  from rooms r
  join work_days w on w.id = r.work_day_id
  where r.id = p_room_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. On INSERT: inherit the rate already established for this show.
-- ---------------------------------------------------------------------------
-- This is what makes staffing someone onto a later day correct automatically,
-- and it deliberately OVERRIDES whatever rate the caller supplied -- the show's
-- own rate outranks the directory default. Note 0 is a real rate (unpaid crew),
-- so the check is IS NOT NULL, never a truthiness test.

create or replace function inherit_show_day_rate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_show_id uuid;
  v_rate numeric;
begin
  v_show_id := show_id_for_room(NEW.room_id);
  if v_show_id is null then
    return NEW;
  end if;

  select t.day_rate into v_rate
  from timecards t
  join rooms r on r.id = t.room_id
  join work_days w on w.id = r.work_day_id
  where w.show_id = v_show_id
    and t.role is not distinct from NEW.role
    and t.day_rate is not null
    and (
      case when NEW.crew_member_id is not null
        then t.crew_member_id = NEW.crew_member_id
        else t.crew_member_id is null and t.crew_member_name = NEW.crew_member_name
      end
    )
  order by t.day_rate desc   -- highest wins, matching the repair above
  limit 1;

  if v_rate is not null then
    NEW.day_rate := v_rate;
  end if;

  return NEW;
end;
$$;

-- Named so it sorts AFTER timecards_blocked_when_finalized: on a locked show the
-- write is rejected before this bothers doing any work.
drop trigger if exists timecards_inherit_show_day_rate on timecards;
create trigger timecards_inherit_show_day_rate
before insert on timecards
for each row
execute function inherit_show_day_rate();

-- ---------------------------------------------------------------------------
-- 4. On UPDATE of day_rate: propagate across the whole show.
-- ---------------------------------------------------------------------------
-- Turns the per-day RoomActionsMenu edit into a show-wide edit instead of a
-- divergence.
--
-- Termination: pg_trigger_depth() stops the cascade from re-firing, and the
-- `is distinct from` guard means there is nothing left to update on a second
-- pass anyway. AFTER ROW triggers are queued until the statement finishes, so a
-- bulk update (Edit Show already issues one) sees the settled state and the
-- propagation finds nothing further to change.

create or replace function propagate_show_day_rate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_show_id uuid;
begin
  -- Only the originating write propagates.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  v_show_id := show_id_for_room(NEW.room_id);
  if v_show_id is null then
    return null;
  end if;

  update timecards t
  set day_rate = NEW.day_rate
  from rooms r
  join work_days w on w.id = r.work_day_id
  where r.id = t.room_id
    and w.show_id = v_show_id
    and t.id <> NEW.id
    and t.role is not distinct from NEW.role
    and t.day_rate is distinct from NEW.day_rate
    and (
      case when NEW.crew_member_id is not null
        then t.crew_member_id = NEW.crew_member_id
        else t.crew_member_id is null and t.crew_member_name = NEW.crew_member_name
      end
    );

  return null;
end;
$$;

drop trigger if exists timecards_propagate_show_day_rate on timecards;
create trigger timecards_propagate_show_day_rate
after update of day_rate on timecards
for each row
when (OLD.day_rate is distinct from NEW.day_rate)
execute function propagate_show_day_rate();

commit;
