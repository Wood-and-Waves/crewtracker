-- Final-review fix for piece C (0035): the staffing_events INSERT policy let
-- anyone who can merely SEE a show write a digest line for it — including a
-- crew-side login, who reaches a show only through show_crew_access because
-- they are staffed on it, not because they may act as its PM. Writing a
-- staffing event is a staffing act (it is what the tracker's staffing writes
-- and Add Day's extension log), so it takes the same permission a timecard
-- write takes: can_edit_timecards. Same shape as the 0019/0020 write-policy
-- fix, on a much newer table.
--
-- Also fixes extend_all_day_positions() (0035): it hard-coded the extended
-- timecard's booking_status to 'pencilled', so a person already confirmed on
-- the day before got demoted back to pencilled on the new day purely by
-- being carried forward — no user action asked for that. It now carries the
-- SOURCE booking's status across instead.
--
-- WRITES NO EXISTING ROWS.

drop policy if exists "Users log staffing events for their shows" on public.staffing_events;
create policy "Users log staffing events for their shows" on public.staffing_events
  for insert with check (
    show_id in (select id from shows)
    and (select my_perm('can_edit_timecards'))
  );

create or replace function public.extend_all_day_positions(p_show_id uuid, p_work_day_id uuid)
returns table (crew_member_id uuid, crew_member_name text, role text)
language plpgsql set search_path = public as $$
declare
  v_new  public.work_days%rowtype;
  v_prev public.work_days%rowtype;
  r record;
  v_slot uuid;
  v_room uuid;
begin
  select * into v_new from work_days where id = p_work_day_id and show_id = p_show_id;
  if v_new.id is null then raise exception 'That day is not on this show.'; end if;
  select * into v_prev from work_days where show_id = p_show_id and date < v_new.date order by date desc limit 1;
  if v_prev.id is null then return; end if;

  for r in
    select d.id as def_id, t.crew_member_id, t.crew_member_name, t.role, t.booking_status
    from position_defs d
    join rooms rp on rp.work_day_id = v_prev.id and rp.name = d.room_name
    join crew_call_positions pp on pp.room_id = rp.id and pp.position_def_id = d.id
    join timecards t on t.call_position_id = pp.id and t.booking_status is distinct from 'declined'
    where d.show_id = p_show_id and d.day_kind = 'all'
    order by d.sort_order, t.crew_member_name
  loop
    select p.id, p.room_id into v_slot, v_room
    from crew_call_positions p join rooms rn on rn.id = p.room_id
    where rn.work_day_id = v_new.id and p.position_def_id = r.def_id
      and not exists (select 1 from timecards x where x.call_position_id = p.id and x.booking_status is distinct from 'declined')
      and (r.crew_member_id is null or not exists (select 1 from timecards y where y.room_id = p.room_id and y.crew_member_id = r.crew_member_id))
    order by p.created_at limit 1;
    if v_slot is null then continue; end if;
    insert into timecards (room_id, crew_member_id, crew_member_name, role, call_position_id, booking_status)
    values (v_room, r.crew_member_id, r.crew_member_name, r.role, v_slot, r.booking_status);
    crew_member_id := r.crew_member_id; crew_member_name := r.crew_member_name; role := r.role;
    return next;
  end loop;
  return;
end; $$;
revoke execute on function public.extend_all_day_positions(uuid, uuid) from public, anon;
grant execute on function public.extend_all_day_positions(uuid, uuid) to authenticated, service_role;
