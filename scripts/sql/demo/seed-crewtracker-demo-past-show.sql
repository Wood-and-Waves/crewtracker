-- THE SECOND DEMO SHOW: one that already happened.
--
-- The first demo show (seed-crewtracker-demo.sql) is next week and has no
-- punches on purpose — a future show carrying hours would be a lie. That left
-- nowhere to demonstrate the tracker, the reports or a crew member's own hours
-- without opening the REAL company on screen, where the names and the rates
-- belong to actual people (Dan, 2026-09-11, writing the overview video).
--
-- So this is the other half: a finished, fully punched, closed-out show in the
-- same demo company. Between the two, the demo has a before and an after — one
-- show being crewed, one show already paid.
--
--   npm run db:sql -- --prod scripts/sql/demo/seed-crewtracker-demo-past-show.sql
--
-- RUN IT AFTER THE OTHER ONE. seed-crewtracker-demo.sql deletes every show in
-- the demo org; this one deletes only its own, by name, so it is safe to re-run
-- on its own but will be wiped by a full reseed.
--
-- SAME TWO GUARDS as the other seed: the organization id is hard-coded AND its
-- name is checked before the first delete, so pointing this at the wrong
-- database raises instead of deleting somebody's shows.
--
-- ORDER IS LOAD-BEARING. Punches go in BEFORE finalized_at is set:
-- punches_blocked_when_finalized is a trigger, and the service role does not
-- bypass triggers, so finalizing first would make every punch insert fail.

do $$
declare
  v_org   constant uuid := 'e24655eb-5514-42d3-b248-3a879677dde9';  -- CrewTracker Demo
  v_dan   constant uuid := '28d3ae69-15bb-42bc-a478-5d9b43b737de';  -- dan@theaudiosmith.com
  v_name  constant text := 'Meridian Partner Summit';
  v_tz    constant text := 'America/Chicago';
  v_org_name text;
  v_pm    uuid;
  v_show  uuid;
  -- Ended a fortnight ago: recent enough to be plausible, long enough ago that
  -- "this show is done" is obvious.
  v_start date := current_date - 20;
  d       integer;
  v_acts  text[];
  v_day   record;
  v_room  uuid;
  v_crew  uuid;
  v_rate  numeric;
  v_tc    uuid;
  b       record;
  v_index integer;
begin
  select name into v_org_name from organizations where id = v_org;
  if v_org_name is distinct from 'CrewTracker Demo' then
    raise exception 'Refusing to seed: % is "%", not the demo organization.',
      v_org, coalesce(v_org_name, 'missing');
  end if;

  -- Only this show. The other seed owns the rest of the org.
  delete from shows where organization_id = v_org and name = v_name;

  select m.profile_id into v_pm
  from memberships m join profiles p on p.id = m.profile_id
  where m.organization_id = v_org and m.deactivated_at is null
    and p.email = 'dan+ray@theaudiosmith.com';
  v_pm := coalesce(v_pm, v_dan);

  insert into shows (organization_id, name, venue, city_state, client_company,
                     job_number, start_date, end_date, timezone_identifier,
                     show_financials, created_by, show_notes)
  values (v_org, v_name, 'Gaylord Texan', 'Grapevine, TX', 'Meridian Financial',
          'CT-2588', v_start, v_start + 4, v_tz, true, v_dan,
          'Demo show, already closed out. Everybody on it is an alias of Dan.')
  returning id into v_show;

  insert into payroll_rulesets (show_id, overtime_after_hours, double_time_enabled,
    double_time_after_hours, meal_penalty_enabled, meal_penalty_grace_period,
    meal_penalty_amount, minimum_meal_break_enabled, minimum_meal_break_minutes,
    meal_break_deduction_cap, short_turn_penalty_enabled, short_turn_rest_hours,
    cancellation_pay_percent)
  values (v_show, 10, true, 12, true, 6, 25, true, 30, 60, true, 10, 50);

  -- Five days: travel in, load-in, rehearsal, show, then show + load-out + home.
  for d in 0..4 loop
    v_acts := case d
      when 0 then array['travel']
      when 1 then array['load_in']
      when 2 then array['rehearsal']
      when 3 then array['show']
      else        array['show','load_out','travel']
    end;
    insert into work_days (show_id, date, day_number, activities)
    values (v_show, v_start + d, d + 1, v_acts);
  end loop;

  insert into rooms (work_day_id, name)
  select wd.id, r.name
  from work_days wd cross join (values ('Grand Ballroom'), ('Salon D')) as r(name)
  where wd.show_id = v_show;

  -- Staffed by hand rather than through position definitions: this show is
  -- history, and its positions were filled long ago. The reports and the
  -- tracker read timecards, which is what matters here.
  for b in
    select * from (values
      -- person, role, room, first day, last day
      ('Alex Reyes',     'A1',              'Grand Ballroom', 0, 4),
      ('Jordan Vega',    'V1',              'Grand Ballroom', 0, 4),
      ('Marcus Webb',    'LD',              'Grand Ballroom', 2, 4),
      ('Priya Nair',     'A2',              'Salon D',        0, 4),
      ('Sofia Duarte',   'Camera Operator', 'Salon D',        3, 4),
      ('Dana Okafor',    'Stagehand',       'Grand Ballroom', 1, 4)
    ) as t(person, role, room, first_day, last_day)
  loop
    select c.id into v_crew from crew_members c
      where c.organization_id = v_org and c.full_name = b.person;
    select rc.day_rate into v_rate from rate_cards rc
      where rc.crew_member_id = v_crew and rc.role = b.role;

    for v_day in
      select id, date, activities, day_number - 1 as idx
      from work_days where show_id = v_show order by day_number
    loop
      continue when v_day.idx < b.first_day or v_day.idx > b.last_day;
      select id into v_room from rooms where work_day_id = v_day.id and name = b.room;

      insert into timecards (room_id, crew_member_id, crew_member_name, role, day_rate,
                             booking_status, booking_invited_at, booking_responded_at,
                             is_travel_day, travel_out_day)
      values (v_room, v_crew, b.person, b.role, v_rate,
              'confirmed', (v_start - 30)::timestamptz, (v_start - 29)::timestamptz,
              -- Day one is a plain travel day for anybody who was there for it.
              v_day.idx = 0 and b.first_day = 0,
              -- The last day is work AND the trip home.
              v_day.idx = 4)
      returning id into v_tc;

      -- PUNCHES. Built from the day's own date in the SHOW's zone, never from a
      -- UTC literal: Grapevine is CDT in September, and writing "13:00Z" by hand
      -- is how a demo ends up showing 8am as 1pm.
      --
      -- A travel day has none, by design.
      continue when v_day.idx = 0 and b.first_day = 0;

      v_index := v_day.idx;
      insert into punches (timecard_id, punch_type, punched_at, source)
      select v_tc, p.kind,
             (v_day.date + p.at) at time zone v_tz,
             case when b.person = 'Alex Reyes' then 'crew' else 'staff' end
      from (values
        ('start'::text,
           case v_index when 1 then '08:00'::time when 2 then '08:00'
                        when 3 then '07:00'      else '08:00' end),
        ('meal_out',
           case v_index when 1 then '12:00'::time when 2 then '12:00'
                        when 3 then '12:00'      else '13:00' end),
        ('meal_in',
           case v_index when 1 then '12:30'::time when 2 then '12:30'
                        when 3 then '12:30'      else '13:30' end),
        ('end',
           case v_index when 1 then '18:30'::time when 2 then '19:30'
                        when 3 then '21:00'      else '23:00' end)
      ) as p(kind, at)
      -- Marcus worked the show day straight through with no break — which is
      -- what a meal penalty IS, and the reports should have one to show.
      where not (b.person = 'Marcus Webb' and v_index = 3 and p.kind in ('meal_out', 'meal_in'));
    end loop;
  end loop;

  -- One day that went wrong, so the absence labels appear somewhere: Dana's
  -- rehearsal day was cancelled by the production, which pays half.
  update timecards t set absence = 'cancelled'
  from rooms r, work_days w
  where r.id = t.room_id and w.id = r.work_day_id
    and w.show_id = v_show and w.date = v_start + 2 and t.crew_member_name = 'Dana Okafor';
  delete from punches p using timecards t, rooms r, work_days w
  where p.timecard_id = t.id and r.id = t.room_id and w.id = r.work_day_id
    and w.show_id = v_show and w.date = v_start + 2 and t.crew_member_name = 'Dana Okafor';

  -- A personal clock link for Alex, so "Your hours" on a finished show can be
  -- opened in a demo. Expiry is derived from the show, so this is already a
  -- lapsed link — which is exactly the state worth showing.
  insert into clock_links (show_id, crew_member_id, organization_id, created_by, expires_at)
  select v_show, c.id, v_org, v_dan, (v_start + 5)::timestamptz
  from crew_members c where c.organization_id = v_org and c.full_name = 'Alex Reyes';

  -- The show as it ended: a PM who accepted, crewed, staffed, and signed off.
  -- finalized_at goes LAST, after every punch is in.
  update shows set
    pm_profile_id          = v_pm,
    pm_invited_at          = (v_start - 40)::timestamptz,
    pm_accepted_at         = (v_start - 39)::timestamptz,
    sent_to_scheduling_at  = (v_start - 35)::timestamptz,
    sent_to_scheduling_by  = v_dan,
    ready_email_sent_at    = (v_start - 25)::timestamptz,
    finalized_at           = (v_start + 6)::timestamptz,
    finalized_by           = v_dan,
    final_report_recipients = 'dan@theaudiosmith.com'
  where id = v_show;

  insert into pm_invites (show_id, profile_id, organization_id, sent_by, sent_at, accepted_at)
  values (v_show, v_pm, v_org, v_dan, (v_start - 40)::timestamptz, (v_start - 39)::timestamptz);

  insert into show_assignments (show_id, profile_id, organization_id, source)
  values (v_show, v_pm, v_org, 'pm');

  raise notice 'Past demo show built: %', v_show;
end $$;

-- What it made.
select s.name, s.start_date, s.end_date, s.finalized_at is not null as closed_out,
       (select count(*) from timecards t where t.show_id = s.id) as timecards,
       (select count(*) from punches p where p.show_id = s.id) as punches,
       (select count(*) from timecards t where t.show_id = s.id and t.absence is not null) as absent_days
from shows s join organizations o on o.id = s.organization_id
where o.name = 'CrewTracker Demo' order by s.start_date;
