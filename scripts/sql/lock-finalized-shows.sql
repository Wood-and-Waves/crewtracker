-- Once a show's Final Report has been sent, its times are read-only.
--
-- Enforced with a TRIGGER rather than RLS, deliberately. RLS policies on
-- punches/timecards would have to reach shows, and CLAUDE.md records a painful
-- incident where cross-referencing policies hit Postgres's per-relation
-- recursion guard — which function wrapping and SECURITY DEFINER did not
-- defeat. A trigger doesn't participate in RLS at all, so there is no recursion
-- to reason about, and unlike a UI check it also blocks a direct REST call.
--
-- Unlocking is an admin action that clears shows.finalized_at; the audit
-- columns (finalized_by, final_report_recipients) are left intact.

create or replace function public.block_writes_when_finalized()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_finalized timestamptz;
begin
  -- Resolve the room, whichever table fired and whichever direction.
  if tg_table_name = 'timecards' then
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
$$;

drop trigger if exists timecards_blocked_when_finalized on timecards;
create trigger timecards_blocked_when_finalized
  before insert or update or delete on timecards
  for each row execute function public.block_writes_when_finalized();

drop trigger if exists punches_blocked_when_finalized on punches;
create trigger punches_blocked_when_finalized
  before insert or update or delete on punches
  for each row execute function public.block_writes_when_finalized();
