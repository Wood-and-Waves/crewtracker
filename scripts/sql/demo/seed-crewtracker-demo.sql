-- THE DEMO COMPANY, ON PRODUCTION.
--
-- Dan, 2026-09-08: "I need to devise a demo company and site that can run on
-- the actual production site." There was nowhere safe to show the app: dev is
-- on localhost or behind Vercel's login, and crewtracker.app holds real crew,
-- so every scheduling button on it emails a real person.
--
-- This builds "CrewTracker Demo" (organization e24655eb…, renamed from Smith
-- Audio, LLC on 2026-09-08) into a company you can press every button in:
-- twelve crew whose addresses are all plus-addressed aliases of
-- dan@theaudiosmith.com, and one show sitting in the middle of being
-- scheduled — confirmed, asked-and-waiting, declined, still pencilled and
-- open, all on screen at once.
--
-- RE-RUNNABLE ON PURPOSE. It deletes the demo org's shows and crew and builds
-- them again, so a rehearsal can be reset in one command and the show's dates
-- are always next week. Run it again after a demo.
--
--   npm run db:sql -- --prod scripts/sql/demo/seed-crewtracker-demo.sql
--
-- IT REFUSES TO RUN ANYWHERE ELSE. The organization id is hard-coded AND its
-- name is checked before a single delete: point this at the wrong database or
-- rename the org and it raises instead of deleting somebody's shows.
--
-- Nothing here is a migration. It touches only rows inside the demo org.

do $$
declare
  v_org  constant uuid := 'e24655eb-5514-42d3-b248-3a879677dde9';  -- CrewTracker Demo
  v_dan  constant uuid := '28d3ae69-15bb-42bc-a478-5d9b43b737de';  -- dan@theaudiosmith.com
  v_name text;
  v_pm   uuid;
  v_show uuid;
  v_start date := current_date + 7;   -- always next week
  v_day  record;
  v_room uuid;
  v_slot uuid;
  v_crew uuid;
  v_rate numeric;
  b      record;
  d      integer;
  v_acts text[];
begin
  -- The guard. Both halves must agree before anything is deleted.
  select name into v_name from organizations where id = v_org;
  if v_name is distinct from 'CrewTracker Demo' then
    raise exception 'Refusing to seed: % is "%", not the demo organization.',
      v_org, coalesce(v_name, 'missing');
  end if;

  -- The production manager is Ray Delgado if his login exists (npm run
  -- demo:team makes it), so the PM's own view can be demonstrated by somebody
  -- who is not the admin. Falls back to Dan so this script stands alone.
  select m.profile_id into v_pm
  from memberships m join profiles p on p.id = m.profile_id
  where m.organization_id = v_org and m.deactivated_at is null
    and p.email = 'dan+ray@theaudiosmith.com';
  v_pm := coalesce(v_pm, v_dan);

  -- Clear the org. Shows cascade to days, rooms, timecards, punches,
  -- positions, invites and staffing events; crew cascade to rate cards and
  -- clock links. Timecards do NOT cascade from crew (no action), which is why
  -- the shows go first.
  delete from shows        where organization_id = v_org;
  delete from crew_members where organization_id = v_org;

  -- The directory. Every address reaches Dan; every phone is in the 555-01xx
  -- range reserved for fiction, so nothing here can dial a real person.
  insert into crew_members (organization_id, full_name, email, phone) values
    (v_org, 'Alex Reyes',      'dan+alex@theaudiosmith.com',   '(214) 555-0101'),
    (v_org, 'Jordan Vega',     'dan+jordan@theaudiosmith.com', '(214) 555-0102'),
    (v_org, 'Priya Nair',      'dan+priya@theaudiosmith.com',  '(214) 555-0103'),
    (v_org, 'Marcus Webb',     'dan+marcus@theaudiosmith.com', '(214) 555-0104'),
    (v_org, 'Sofia Duarte',    'dan+sofia@theaudiosmith.com',  '(214) 555-0105'),
    (v_org, 'Theo Lindqvist',  'dan+theo@theaudiosmith.com',   '(214) 555-0106'),
    (v_org, 'Dana Okafor',     'dan+dana@theaudiosmith.com',   '(214) 555-0107'),
    (v_org, 'Ruth Callahan',   'dan+ruth@theaudiosmith.com',   '(214) 555-0108'),
    (v_org, 'Miles Turner',    'dan+miles@theaudiosmith.com',  '(214) 555-0109'),
    (v_org, 'Nina Brennan',    'dan+nina@theaudiosmith.com',   '(214) 555-0110'),
    (v_org, 'Chris Ferraro',   'dan+chris@theaudiosmith.com',  '(214) 555-0111'),
    (v_org, 'Sam Whitfield',   'dan+sam@theaudiosmith.com',    '(214) 555-0112');

  -- What each of them does, and for how much. Two people hold each of the
  -- headline roles so the fill picker has somebody to choose between.
  insert into rate_cards (crew_member_id, role, day_rate)
  select c.id, r.role, r.rate
  from crew_members c
  join (values
    ('Alex Reyes',     'A1',              750),
    ('Chris Ferraro',  'A1',              750),
    ('Jordan Vega',    'V1',              700),
    ('Sam Whitfield',  'V1',              700),
    ('Priya Nair',     'A2',              650),
    ('Marcus Webb',    'LD',              725),
    ('Sofia Duarte',   'Camera Operator', 600),
    ('Theo Lindqvist', 'Camera Operator', 600),
    ('Dana Okafor',    'Stagehand',       425),
    ('Ruth Callahan',  'Stagehand',       425),
    ('Miles Turner',   'Stagehand',       425),
    ('Nina Brennan',   'Stagehand',       425)
  ) as r(person, role, rate) on r.person = c.full_name
  where c.organization_id = v_org;

  -- The show. Next week, six days, two rooms, money on.
  insert into shows (organization_id, name, venue, city_state, client_company,
                     job_number, start_date, end_date, timezone_identifier,
                     show_financials, created_by, show_notes)
  values (v_org, 'Northwind Global Sales Kickoff', 'Hilton Anatole', 'Dallas, TX',
          'Northwind Logistics', 'CT-2601', v_start, v_start + 5, 'America/Chicago',
          true, v_dan, 'Demo show. Everybody on it is an alias of Dan.')
  returning id into v_show;

  insert into payroll_rulesets (show_id, overtime_after_hours, double_time_enabled,
    double_time_after_hours, meal_penalty_enabled, meal_penalty_grace_period,
    meal_penalty_amount, minimum_meal_break_enabled, minimum_meal_break_minutes,
    meal_break_deduction_cap, short_turn_penalty_enabled, short_turn_rest_hours,
    cancellation_pay_percent)
  values (v_show, 10, true, 12, true, 6, 25, true, 30, 60, true, 10, 50);

  -- The run: travel in, load-in, rehearsal, two show days, then show and
  -- load-out with the trip home.
  for d in 0..5 loop
    v_acts := case d
      when 0 then array['travel']
      when 1 then array['load_in']
      when 2 then array['rehearsal']
      when 3 then array['show']
      when 4 then array['show']
      else        array['show','load_out','travel']
    end;
    insert into work_days (show_id, date, day_number, activities)
    values (v_show, v_start + d, d + 1, v_acts);
  end loop;

  -- Both rooms exist on every day, the way the New Show grid builds them.
  -- sync_position_slots only fills rooms that are already there.
  insert into rooms (work_day_id, name)
  select wd.id, r.name
  from work_days wd cross join (values ('Ballroom A'), ('Salon C')) as r(name)
  where wd.show_id = v_show;

  -- Positions as a salesperson says them: a role, for these kinds of day.
  insert into position_defs (show_id, room_name, role, count, day_kind, sort_order, created_by) values
    (v_show, 'Ballroom A', 'A1',              1, 'all',  1, v_dan),
    (v_show, 'Ballroom A', 'V1',              1, 'all',  2, v_dan),
    (v_show, 'Ballroom A', 'LD',              1, 'show', 3, v_dan),
    (v_show, 'Ballroom A', 'Stagehand',       3, 'load', 4, v_dan),
    (v_show, 'Salon C',    'A2',              1, 'all',  5, v_dan),
    (v_show, 'Salon C',    'Camera Operator', 2, 'show', 6, v_dan);

  perform sync_position_slots(v_show);

  -- Who has answered what. Every state the Scheduling screen can show:
  -- confirmed, asked and waiting, declined, never asked — and one position
  -- left open, because a demo of scheduling needs something left to schedule.
  for b in
    select * from (values
      ('Alex Reyes',     'A1',              'Ballroom A', 'all',  'confirmed'),
      ('Jordan Vega',    'V1',              'Ballroom A', 'all',  'invited'),
      ('Marcus Webb',    'LD',              'Ballroom A', 'show', 'confirmed'),
      ('Dana Okafor',    'Stagehand',       'Ballroom A', 'load', 'confirmed'),
      ('Ruth Callahan',  'Stagehand',       'Ballroom A', 'load', 'declined'),
      ('Miles Turner',   'Stagehand',       'Ballroom A', 'load', 'pencilled'),
      ('Priya Nair',     'A2',              'Salon C',    'all',  'confirmed'),
      ('Sofia Duarte',   'Camera Operator', 'Salon C',    'show', 'invited')
    ) as t(person, role, room, kind, status)
  loop
    select c.id into v_crew from crew_members c
      where c.organization_id = v_org and c.full_name = b.person;
    select rc.day_rate into v_rate from rate_cards rc
      where rc.crew_member_id = v_crew and rc.role = b.role;

    for v_day in select id, date, activities from work_days where show_id = v_show order by day_number loop
      continue when not position_def_wants(b.kind, null::date[], v_day.activities, v_day.date);

      select id into v_room from rooms where work_day_id = v_day.id and name = b.room;

      -- The first slot of that role nobody holds. A declined booking keeps its
      -- slot, exactly as it does in the app.
      select p.id into v_slot from crew_call_positions p
       where p.room_id = v_room and p.role = b.role
         and not exists (select 1 from timecards t
                          where t.call_position_id = p.id
                            and t.booking_status is distinct from 'declined')
       order by p.created_at limit 1;
      continue when v_slot is null;

      insert into timecards (room_id, crew_member_id, crew_member_name, role, day_rate,
                             call_position_id, booking_status, booking_invited_at,
                             booking_responded_at, is_travel_day)
      values (v_room, v_crew, b.person, b.role, v_rate, v_slot, b.status,
              case when b.status <> 'pencilled' then now() - interval '2 days' end,
              case when b.status in ('confirmed','declined') then now() - interval '1 day' end,
              v_day.activities = array['travel']);
    end loop;
  end loop;

  -- The production manager said yes, which is the only thing that opens a show.
  update shows set
    pm_profile_id         = v_pm,
    pm_invited_at         = now() - interval '3 days',
    pm_accepted_at        = now() - interval '3 days',
    sent_to_scheduling_at = now() - interval '2 days',
    sent_to_scheduling_by = v_dan
  where id = v_show;

  insert into pm_invites (show_id, profile_id, organization_id, sent_by, sent_at, accepted_at)
  values (v_show, v_pm, v_org, v_dan, now() - interval '3 days', now() - interval '3 days');

  insert into show_assignments (show_id, profile_id, organization_id, source)
  values (v_show, v_pm, v_org, 'pm');

  raise notice 'Demo show built: %', v_show;
end $$;

-- What it made.
select s.name as show, s.start_date, s.end_date,
       (select count(*) from work_days w where w.show_id = s.id) as days,
       (select count(*) from crew_call_positions p join rooms r on r.id = p.room_id where r.show_id = s.id) as slots,
       (select count(*) from timecards t where t.show_id = s.id) as bookings,
       s.pm_accepted_at is not null as pm_accepted
from shows s join organizations o on o.id = s.organization_id
where o.name = 'CrewTracker Demo';

select t.booking_status, count(distinct t.crew_member_id) as people, count(*) as positions
from timecards t join shows s on s.id = t.show_id join organizations o on o.id = s.organization_id
where o.name = 'CrewTracker Demo'
group by t.booking_status order by t.booking_status;

select count(*) as open_positions
from crew_call_positions p join rooms r on r.id = p.room_id
join shows s on s.id = r.show_id join organizations o on o.id = s.organization_id
where o.name = 'CrewTracker Demo'
  and not exists (select 1 from timecards t where t.call_position_id = p.id
                    and t.booking_status is distinct from 'declined');
