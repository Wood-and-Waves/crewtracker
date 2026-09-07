-- Section 5 of the 2026-09-06 spec: only an admin or the show's PM may reopen
-- a show whose Final Report was sent.
--
-- What the database already did: the shows UPDATE policy requires
-- can_edit_timecards AND (see-all OR on the access list OR creator), so a
-- crew-side or view-only login could never clear finalized_at. What it did
-- NOT do: name the rule. This trigger says it out loud, adds the scheduler arm
-- (0013 gave schedulers the show but the UPDATE policy never learned it), and
-- makes "PM-side" the one definition — my_pm_show_ids() — that the app's
-- pages use, so the button and the database can never disagree about who.
--
-- The finalized-write message also changes: it promised "An admin can unlock
-- it", which was never the whole truth. Same body, one sentence.

create or replace function public.guard_show_unlock() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if old.finalized_at is not null and new.finalized_at is null and auth.uid() is not null then
    if not (my_perm('can_manage_users') or new.id in (select my_pm_show_ids())) then
      raise exception 'Only an admin or the show''s PM can unlock a finalized show.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists guard_show_unlock on public.shows;
create trigger guard_show_unlock before update of finalized_at on public.shows
  for each row execute function public.guard_show_unlock();

create or replace function public.block_writes_when_finalized() returns trigger
language plpgsql security definer set search_path to 'public' as $$
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
      'This show was finalized on % and its times are read-only. An admin or the show''s PM can unlock it.',
      to_char(v_finalized, 'YYYY-MM-DD')
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;
