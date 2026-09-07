-- Piece C of the 2026-09-07 show-flow spec: the scheduling QUEUE.
--
-- A show is no longer handed to ONE scheduler. "Send to scheduler" stamps
-- sent_to_scheduling_at and emails everyone with can_manage_scheduling; from
-- then on every scheduler is PM-side on it. The scheduler_id arm of every
-- visibility rule becomes "holds the permission AND the show has been sent".
-- scheduler_id / call_approved_at / call_approved_by stay as history and are
-- written by nothing after this migration.
--
-- WRITES EXISTING ROWS: sent_to_scheduling_at is backfilled from
-- call_approved_at, so a show handed off before this keeps its state and its
-- scheduler keeps seeing it (as long as they hold the permission — the
-- superadmin panel grants it per member).
--
-- staffing_events feeds the evening digest; extend_all_day_positions() is Add
-- Day's "extend everyone on all-day positions" — SECURITY INVOKER, so RLS and
-- the timecards write policy still decide who may call it.

-- 1. Columns.
alter table public.shows
  add column if not exists sent_to_scheduling_at timestamptz null,
  add column if not exists sent_to_scheduling_by uuid null references public.profiles(id) on delete set null,
  add column if not exists ready_email_sent_at timestamptz null;
update public.shows set sent_to_scheduling_at = call_approved_at, sent_to_scheduling_by = call_approved_by
  where call_approved_at is not null and sent_to_scheduling_at is null;
create index if not exists shows_sent_to_scheduling_idx on public.shows (sent_to_scheduling_at) where sent_to_scheduling_at is not null;

-- 2. The scheduler door, everywhere the old arm lived.
alter policy "Users see their org shows" on public.shows
  using (
    organization_id = (select my_organization_id())
    and (
      (select can_see_all_shows())
      or id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or created_by = (select auth.uid())
      or ((select my_perm('can_manage_scheduling')) and sent_to_scheduling_at is not null)
      or id in (select show_id from show_crew_access where profile_id = (select auth.uid()))
    )
  );

create or replace function public.my_pm_show_ids() returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select s.id from shows s
  where s.organization_id = my_organization_id()
    and ( can_see_all_shows()
       or s.created_by = auth.uid()
       or (my_perm('can_manage_scheduling') and s.sent_to_scheduling_at is not null)
       or s.id in (select show_id from show_assignments where profile_id = auth.uid()) );
$$;

alter policy "Users see timecards for their shows" on public.timecards
  using (
    show_id in (select id from shows)
    and (
      (select can_see_all_shows())
      or crew_member_id in (select my_crew_member_ids())
      or show_id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or show_id in (select id from shows where created_by = (select auth.uid())
                       or ((select my_perm('can_manage_scheduling')) and sent_to_scheduling_at is not null))
    )
  );

alter policy "Users see punches for their timecards" on public.punches
  using (
    show_id in (select id from shows)
    and (
      (select can_see_all_shows())
      or show_id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or show_id in (select id from shows where created_by = (select auth.uid())
                       or ((select my_perm('can_manage_scheduling')) and sent_to_scheduling_at is not null))
      or timecard_id in (select id from timecards where crew_member_id in (select my_crew_member_ids()))
    )
  );

create or replace view public.timecard_day_rates with (security_invoker = false) as
  select t.id as timecard_id, w.show_id, t.day_rate
  from timecards t
  join rooms r on r.id = t.room_id
  join work_days w on w.id = r.work_day_id
  join shows s on s.id = w.show_id
  where s.organization_id = (select my_organization_id())
    and (select my_perm('can_view_pay_rates'))
    and (
      (select can_see_all_shows())
      or exists (select 1 from show_assignments sa
                  where sa.show_id = s.id and sa.profile_id = (select auth.uid()))
      or s.created_by = (select auth.uid())
      or ((select my_perm('can_manage_scheduling')) and s.sent_to_scheduling_at is not null)
    );

-- 3. Staffing events — the digest's diary. Written by the app (routes and the
--    tracker's staffing writes), read by the digest cron (service role), and
--    marked sent there. organization_id is denormalized by trigger, the same
--    shape as show_assignments, so the policy never has to walk to shows for
--    the org.
create table if not exists public.staffing_events (
  id               uuid primary key default gen_random_uuid(),
  show_id          uuid not null references public.shows(id) on delete cascade,
  organization_id  uuid null references public.organizations(id) on delete cascade,
  at               timestamptz not null default now(),
  kind             text not null check (kind in ('booked','accepted','declined','released','days_changed','moved','extended')),
  crew_member_id   uuid null references public.crew_members(id) on delete set null,
  crew_member_name text not null,
  role             text null,
  days             text null,
  actor            uuid null references public.profiles(id) on delete set null,
  sent_at          timestamptz null
);
create index if not exists staffing_events_unsent_idx on public.staffing_events (show_id) where sent_at is null;
alter table public.staffing_events enable row level security;
alter table public.staffing_events force row level security;
create or replace function public.set_staffing_event_organization_id() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin select s.organization_id into new.organization_id from shows s where s.id = new.show_id; return new; end; $$;
drop trigger if exists set_staffing_event_organization_id on public.staffing_events;
create trigger set_staffing_event_organization_id before insert on public.staffing_events
  for each row execute function public.set_staffing_event_organization_id();
drop policy if exists "Users see staffing events for their shows" on public.staffing_events;
create policy "Users see staffing events for their shows" on public.staffing_events
  for select using (show_id in (select id from shows));
drop policy if exists "Users log staffing events for their shows" on public.staffing_events;
create policy "Users log staffing events for their shows" on public.staffing_events
  for insert with check (show_id in (select id from shows));
grant select, insert on public.staffing_events to authenticated;

-- 4. The flags view learns crew_member_id, so a crew change notice can name
--    the person (Task 6). Same columns as 0034 plus one, APPENDED at the end
--    — CREATE OR REPLACE VIEW refuses to reorder or insert a column among
--    existing ones, only to add new ones after the last.
create or replace view public.position_slot_flags with (security_invoker = true) as
  select p.id as slot_id, wd.show_id, p.position_def_id, rm.name as room_name, wd.date, p.role,
         t.id as timecard_id, t.crew_member_name, t.crew_member_id
  from crew_call_positions p
  join position_defs d on d.id = p.position_def_id
  join rooms rm on rm.id = p.room_id
  join work_days wd on wd.id = rm.work_day_id
  join timecards t on t.call_position_id = p.id and t.booking_status is distinct from 'declined'
  where not (rm.name = d.room_name and position_def_wants(d.day_kind, d.custom_dates, wd.activities, wd.date));

-- 5. Add Day: extend everyone on an all-day position to the new day. For each
--    definition with day_kind 'all', every person booked into one of its slots
--    on the day BEFORE the new one gets the first open slot of that definition
--    on the new day. Skips anyone already in that room that day. Returns the
--    number of people extended. SECURITY INVOKER: the timecards INSERT policy
--    (can_edit_timecards) applies.
create or replace function public.extend_all_day_positions(p_show_id uuid, p_work_day_id uuid)
returns table (crew_member_id uuid, crew_member_name text, role text)
language plpgsql as $$
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
    select d.id as def_id, t.crew_member_id, t.crew_member_name, t.role
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
    values (v_room, r.crew_member_id, r.crew_member_name, r.role, v_slot, 'pencilled');
    crew_member_id := r.crew_member_id; crew_member_name := r.crew_member_name; role := r.role;
    return next;
  end loop;
  return;
end; $$;
revoke execute on function public.extend_all_day_positions(uuid, uuid) from public, anon;
grant execute on function public.extend_all_day_positions(uuid, uuid) to authenticated, service_role;
