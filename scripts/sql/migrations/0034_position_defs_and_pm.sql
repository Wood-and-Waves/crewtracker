-- Piece B of the 2026-09-07 show-flow spec.
--
-- A POSITION IS "A ROLE, FOR THESE KINDS OF DAY". Sales says "2 stagehands in
-- the Ballroom for load-in and load-out"; the app works out the days from the
-- day grid (work_days.activities, 0032). The per-day slots the scheduler fills
-- stay what they are — crew_call_positions rows — and gain a parent that says
-- WHY they exist, so they can follow the day grid when it changes.
--
-- THE ONE RULE: the app adds open slots freely and NEVER removes a booked
-- person. sync_position_slots() deletes only unfilled slots; a filled slot
-- whose day no longer fits its definition is a FLAG (position_slot_flags) for
-- a human to move / keep / release.
--
-- THE PM IS INVITED, AND ACCEPTING IS WHAT GRANTS ACCESS. shows.pm_profile_id
-- names them; a pm_invites row carries the token; accepting writes the
-- show_assignments row (source='pm'). Nothing else counts. Dan: a silent
-- accept is dangerous.
--
-- Legacy rows (position_def_id null) — every slot that exists today and
-- anything CrewCallModal creates — are untouched by the sync.
-- Writes NO existing rows.

-- 1. Definitions.
create table if not exists public.position_defs (
  id            uuid primary key default gen_random_uuid(),
  show_id       uuid not null references public.shows(id) on delete cascade,
  room_name     text not null,
  role          text not null,
  count         integer not null default 1 check (count between 1 and 99),
  day_kind      text not null default 'all' check (day_kind in ('all','show','load','custom')),
  custom_dates  date[] null,
  sort_order    integer not null default 0,
  created_by    uuid null references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists position_defs_show_idx on public.position_defs (show_id);
alter table public.position_defs enable row level security;
alter table public.position_defs force row level security;
-- Same scope as crew_call_positions: anyone who can see the show.
drop policy if exists "Users see position defs for their shows" on public.position_defs;
create policy "Users see position defs for their shows" on public.position_defs
  for select using (show_id in (select id from shows));
drop policy if exists "Users manage position defs for their shows" on public.position_defs;
create policy "Users manage position defs for their shows" on public.position_defs
  for all using (show_id in (select id from shows)) with check (show_id in (select id from shows));
grant select, insert, update, delete on public.position_defs to authenticated;

alter table public.crew_call_positions
  add column if not exists position_def_id uuid null references public.position_defs(id) on delete set null;
create index if not exists crew_call_positions_def_idx on public.crew_call_positions (position_def_id);

-- 2. Which room-days a definition wants. `load` = load_in OR load_out.
create or replace function public.position_def_wants(p_kind text, p_custom date[], p_activities text[], p_date date)
returns boolean language sql immutable as $$
  select case p_kind
    when 'all'    then true
    when 'show'   then 'show' = any(coalesce(p_activities, '{}'))
    when 'load'   then coalesce(p_activities, '{}') && array['load_in','load_out']
    when 'custom' then p_date = any(coalesce(p_custom, '{}'))
    else false end;
$$;

-- 3. The derivation. SECURITY INVOKER on purpose: it runs as the caller, so
--    the crew_call_positions policies decide what they may touch.
create or replace function public.sync_position_slots(p_show_id uuid) returns void
language plpgsql as $$
declare
  d public.position_defs%rowtype;
  r record;
  have integer;
begin
  for d in select * from position_defs where show_id = p_show_id loop
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
revoke execute on function public.sync_position_slots(uuid) from public, anon;
grant execute on function public.sync_position_slots(uuid) to authenticated, service_role;

-- 4. Filled slots whose day no longer fits their definition.
create or replace view public.position_slot_flags with (security_invoker = true) as
  select p.id as slot_id, wd.show_id, p.position_def_id, rm.name as room_name, wd.date, p.role,
         t.id as timecard_id, t.crew_member_name
  from crew_call_positions p
  join position_defs d on d.id = p.position_def_id
  join rooms rm on rm.id = p.room_id
  join work_days wd on wd.id = rm.work_day_id
  join timecards t on t.call_position_id = p.id and t.booking_status is distinct from 'declined'
  where not (rm.name = d.room_name and position_def_wants(d.day_kind, d.custom_dates, wd.activities, wd.date));
grant select on public.position_slot_flags to authenticated;

-- 5. The PM. shows is table-granted, so the new columns need no grant.
alter table public.shows
  add column if not exists pm_profile_id uuid null references public.profiles(id) on delete set null,
  add column if not exists pm_invited_at timestamptz null,
  add column if not exists pm_accepted_at timestamptz null;

create table if not exists public.pm_invites (
  id              uuid primary key default gen_random_uuid(),
  token           uuid not null unique default gen_random_uuid(),
  show_id         uuid not null references public.shows(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sent_by         uuid null references public.profiles(id),
  sent_at         timestamptz not null default now(),
  accepted_at     timestamptz null
);
create index if not exists pm_invites_show_idx on public.pm_invites (show_id);
alter table public.pm_invites enable row level security;
alter table public.pm_invites force row level security;
-- Readable/creatable by anyone who can see the show. The token is what the
-- invitee uses, via the service role; nobody reads it from a browser.
drop policy if exists "Users see pm invites for their shows" on public.pm_invites;
create policy "Users see pm invites for their shows" on public.pm_invites
  for select using (organization_id = (select my_organization_id()) and show_id in (select id from shows));
drop policy if exists "Users create pm invites for their shows" on public.pm_invites;
create policy "Users create pm invites for their shows" on public.pm_invites
  for insert with check (organization_id = (select my_organization_id()) and show_id in (select id from shows));
drop policy if exists "Users delete pm invites for their shows" on public.pm_invites;
create policy "Users delete pm invites for their shows" on public.pm_invites
  for delete using (organization_id = (select my_organization_id()) and show_id in (select id from shows));
grant select, insert, delete on public.pm_invites to authenticated;

alter table public.show_assignments
  add column if not exists source text not null default 'manual' check (source in ('manual','pm'));
