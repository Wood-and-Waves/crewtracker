-- THE SHOW THAT CLASHES.
--
-- Dan, 2026-09-11: "I would like to show in the demo what it looks like when a
-- crew is already booked for the dates. That is a selling point."
--
-- It is, and it needs a THIRD show: the fill picker warns about anybody with a
-- live booking on that DATE across the company, so with only Northwind (next
-- week) and Meridian (a fortnight ago) there is nothing to collide with.
--
-- This is that show — Cypress Dealer Meeting, three days sitting inside
-- Northwind's run, with three people confirmed on it who are exactly the people
-- a scheduler would reach for on Northwind's open positions:
--
--   Theo Lindqvist  — the other Camera Operator, and Northwind has three open
--   Nina Brennan    — a Stagehand, and Northwind has the decliner's slots open
--   Chris Ferraro   — the other A1
--
-- So opening any of those Northwind slots shows "Already scheduled on Cypress
-- Dealer Meeting" beside their name, and the button reads **Book anyway**.
--
-- IT IS SENT TO SCHEDULING, and that is load-bearing rather than decoration.
-- The picker's conflict query runs under the CALLER's RLS, and a scheduler sees
-- a show only once it has been sent. Record the demo as Sasha with this show
-- unsent and the warning simply does not appear — the app would be right and
-- the demo would look broken.
--
-- IT STAYS OUT OF THE QUEUE. Everybody on it is confirmed and it has no
-- position definitions, so there is no open slot, nobody waiting and no flag —
-- which is exactly what keeps it off the Needs-scheduling list while the demo
-- is looking at that list.
--
--   npm run db:sql -- --prod scripts/sql/demo/seed-crewtracker-demo-clash.sql
--
-- Run it after the main seed, which deletes every show in the org. This one
-- deletes only its own, by name.

do $$
declare
  v_org   constant uuid := 'e24655eb-5514-42d3-b248-3a879677dde9';  -- CrewTracker Demo
  v_dan   constant uuid := '28d3ae69-15bb-42bc-a478-5d9b43b737de';
  v_name  constant text := 'Cypress Dealer Meeting';
  v_org_name text;
  v_show  uuid;
  -- DERIVED FROM NORTHWIND, not from today. Both seeds compute their dates
  -- from the day they are run, so a fixed offset from current_date drifts apart
  -- the moment they are run on different days — and the overlap has to land on
  -- Northwind's SHOW days, because that is where its open Camera Operator slots
  -- are. Starting on Northwind's second show day leaves the first one clean, so
  -- the demo can show a booking that warns and one that does not.
  v_start date;
  d       integer;
  v_day   record;
  v_room  uuid;
  v_crew  uuid;
  v_rate  numeric;
  b       record;
begin
  select name into v_org_name from organizations where id = v_org;
  if v_org_name is distinct from 'CrewTracker Demo' then
    raise exception 'Refusing to seed: % is "%", not the demo organization.',
      v_org, coalesce(v_org_name, 'missing');
  end if;

  delete from shows where organization_id = v_org and name = v_name;

  select s.start_date + 4 into v_start
  from shows s
  where s.organization_id = v_org and s.name = 'Northwind Global Sales Kickoff';
  if v_start is null then
    raise exception 'Seed Northwind first: this show exists to clash with it.';
  end if;

  insert into shows (organization_id, name, venue, city_state, client_company,
                     job_number, start_date, end_date, timezone_identifier,
                     show_financials, created_by, show_notes,
                     sent_to_scheduling_at, sent_to_scheduling_by)
  values (v_org, v_name, 'Omni Frisco', 'Frisco, TX', 'Cypress Auto Group',
          'CT-2604', v_start, v_start + 2, 'America/Chicago', true, v_dan,
          'Demo show. Exists so the scheduling screen has a real clash to warn about.',
          now() - interval '6 days', v_dan)
  returning id into v_show;

  insert into payroll_rulesets (show_id, overtime_after_hours, double_time_enabled,
    double_time_after_hours, meal_penalty_enabled, meal_penalty_grace_period,
    meal_penalty_amount, minimum_meal_break_enabled, minimum_meal_break_minutes,
    meal_break_deduction_cap, short_turn_penalty_enabled, short_turn_rest_hours,
    cancellation_pay_percent)
  values (v_show, 10, true, 12, true, 6, 25, true, 30, 60, true, 10, 50);

  for d in 0..2 loop
    insert into work_days (show_id, date, day_number, activities)
    values (v_show, v_start + d, d + 1,
            case d when 0 then array['load_in'] when 1 then array['show'] else array['show','load_out'] end);
  end loop;

  insert into rooms (work_day_id, name)
  select wd.id, 'Main Hall' from work_days wd where wd.show_id = v_show;

  -- Confirmed, so the warning reads "Already scheduled on…" rather than
  -- "pending on…" — a held date is the thing a scheduler needs to see.
  for b in
    select * from (values
      ('Theo Lindqvist', 'Camera Operator'),
      ('Nina Brennan',   'Stagehand'),
      ('Chris Ferraro',  'A1')
    ) as t(person, role)
  loop
    select c.id into v_crew from crew_members c
      where c.organization_id = v_org and c.full_name = b.person;
    select rc.day_rate into v_rate from rate_cards rc
      where rc.crew_member_id = v_crew and rc.role = b.role;

    for v_day in select id from work_days where show_id = v_show order by day_number loop
      select id into v_room from rooms where work_day_id = v_day.id;
      insert into timecards (room_id, crew_member_id, crew_member_name, role, day_rate,
                             booking_status, booking_invited_at, booking_responded_at)
      values (v_room, v_crew, b.person, b.role, v_rate, 'confirmed',
              now() - interval '5 days', now() - interval '4 days');
    end loop;
  end loop;

  raise notice 'Clash show built: %', v_show;
end $$;

-- The three demo shows, and who is double-booked against Northwind.
select s.name, s.start_date, s.end_date,
       s.sent_to_scheduling_at is not null as sent,
       s.finalized_at is not null as closed_out,
       (select count(*) from timecards t where t.show_id = s.id) as bookings
from shows s join organizations o on o.id = s.organization_id
where o.name = 'CrewTracker Demo' order by s.start_date;

select t.crew_member_name as who, t.role, count(distinct w.date) as clashing_days
from timecards t
join rooms r on r.id = t.room_id join work_days w on w.id = r.work_day_id
join shows s on s.id = w.show_id join organizations o on o.id = s.organization_id
where o.name = 'CrewTracker Demo' and s.name = 'Cypress Dealer Meeting'
  and w.date in (select w2.date from work_days w2 join shows s2 on s2.id = w2.show_id
                 where s2.name = 'Northwind Global Sales Kickoff')
group by t.crew_member_name, t.role order by t.crew_member_name;
