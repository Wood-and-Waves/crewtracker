-- Fix: every write to timecards started failing with
-- "permission denied for table timecards" after day_rate was revoked from
-- `authenticated` (scripts/sql/lock-down-day-rate.sql).
--
-- Cause: the two show-wide day-rate triggers were written SECURITY INVOKER, and
-- BOTH read day_rate —
--   * inherit_show_day_rate   SELECTs the show's existing rate to copy onto a
--                             new timecard
--   * propagate_show_day_rate UPDATEs siblings `where day_rate is distinct from`
-- so once the invoking role lost SELECT on that column, staffing crew, copying a
-- roster to a new day, and editing a rate all failed.
--
-- These functions enforce an internal invariant ("a rate belongs to the show,
-- not the day"); they are not a user-facing data path. Running them with
-- definer rights is the correct fix, not a workaround: the alternative is
-- handing every user back SELECT on the column the lockdown exists to remove.
--
-- Bypassing RLS is acceptable here and deliberately narrow:
--   * both only touch rows for the SAME (show, crew member, role) as the row
--     being written, which the caller already had to pass RLS to write;
--   * the finalized-show block is a separate BEFORE trigger and still fires on
--     the rows propagation touches, so a locked show stays locked.
--
-- search_path is pinned per the handle_new_user incident in CLAUDE.md.
--
-- Only the security context changes below; the bodies are unchanged from
-- scripts/sql/show-wide-day-rate.sql.

begin;

create or replace function inherit_show_day_rate()
returns trigger
language plpgsql
security definer
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
  order by t.day_rate desc
  limit 1;

  if v_rate is not null then
    NEW.day_rate := v_rate;
  end if;

  return NEW;
end;
$$;

create or replace function propagate_show_day_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_show_id uuid;
begin
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

commit;
