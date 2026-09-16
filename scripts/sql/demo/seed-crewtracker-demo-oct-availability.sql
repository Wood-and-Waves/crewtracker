-- ENOUGH PEOPLE TO STAFF A WEEK, AND SOME WHO ARE NOT FREE.
--
-- Dan, 2026-09-15: staffing Oct 1–5 with 3 BO Techs, 1 A1, 1 V1, 1 LD and 1
-- Stagehand, and wanting "enough of each type in the directory, plus some that
-- will be unavailable due to other shows."
--
-- The demo directory could not do it. The twelve people in the main seed hold
-- A1 ×2, V1 ×2, A2, LD ×1, Camera Operator ×2 and Stagehand ×4 — and **not one
-- BO Tech**, which is three of the seven positions. The fill picker would have
-- opened on an empty list on the busiest line of the sheet.
--
-- This file does two things:
--
--   1. ADDS ten people (it never deletes any), so every role Dan is filling has
--      at least two candidates free after the clashes are taken out.
--   2. Builds ONE clashing show across the same five days, with one person from
--      each of those roles confirmed on it — so every line of his sheet has at
--      least one name that comes back "Already scheduled on…".
--
-- It is ADDITIVE and safe to run twice: every insert is guarded on the person
-- not already being there, and the show is deleted by name before it is built.
--
-- RUN IT AFTER THE MAIN SEED, always. `seed-crewtracker-demo.sql` deletes every
-- show AND every crew member in the org, so running it afterwards takes these
-- ten people with it. `npm run demo:reset` has this file last for that reason.
--
--   npm run db:sql -- --prod scripts/sql/demo/seed-crewtracker-demo-oct-availability.sql

do $$
declare
  v_org   constant uuid := 'e24655eb-5514-42d3-b248-3a879677dde9';  -- CrewTracker Demo
  v_dan   constant uuid := '28d3ae69-15bb-42bc-a478-5d9b43b737de';
  v_name  constant text := 'Lakeshore Investor Day';
  v_org_name text;
  v_show  uuid;
  -- THE FIRST OCTOBER STILL AHEAD. Dan named the dates, so unlike the other
  -- demo seeds these are not an offset from today — but a hardcoded 2026 would
  -- quietly seed a show in the past from next autumn on, and a show in the past
  -- raises no conflict at all, so the demo would look broken while the app was
  -- right. Roll to next year once the window has closed.
  v_start date := make_date(
    extract(year from current_date)::int
      + case when current_date > make_date(extract(year from current_date)::int, 10, 5) then 1 else 0 end,
    10, 1);
  -- A PARTIAL OVERLAP, not the whole week (Dan, 2026-09-16). Covering all five
  -- days made everybody on it unavailable for the entire run, so there was no
  -- clean day to book against — and the point of the beat is the CONTRAST: one
  -- booking that goes straight in, then the same reach hitting somebody who is
  -- spoken for. Starting on the third day leaves the travel and load-in clear.
  v_clash  date := v_start + 2;
  v_clash_days constant integer := 2;   -- 0..2, so three days
  d       integer;
  v_day   record;
  v_room  uuid;
  v_crew  uuid;
  v_rate  numeric;
  p       record;
  b       record;
begin
  select name into v_org_name from organizations where id = v_org;
  if v_org_name is distinct from 'CrewTracker Demo' then
    raise exception 'Refusing to seed: % is "%", not the demo organization.',
      v_org, coalesce(v_org_name, 'missing');
  end if;

  ------------------------------------------------------------------ the people
  -- Aliases of dan@theaudiosmith.com and (214) 555-01xx numbers, the same as
  -- the main seed: every email this demo sends has to land in Dan's inbox, and
  -- 555-01xx is the range reserved for fiction. Phones continue from 0112.
  for p in
    select * from (values
      ('Hana Kwon',       'dan+hana@theaudiosmith.com',     '(214) 555-0113', 'BO Tech',   575),
      ('Desmond Pike',    'dan+desmond@theaudiosmith.com',  '(214) 555-0114', 'BO Tech',   575),
      ('Lucia Ferrer',    'dan+lucia@theaudiosmith.com',    '(214) 555-0115', 'BO Tech',   575),
      ('Owen Baptiste',   'dan+owen@theaudiosmith.com',     '(214) 555-0116', 'BO Tech',   575),
      ('Farrah Nasser',   'dan+farrah@theaudiosmith.com',   '(214) 555-0117', 'BO Tech',   575),
      ('Gil Tran',        'dan+gil@theaudiosmith.com',      '(214) 555-0118', 'BO Tech',   575),
      ('Bianca Moss',     'dan+bianca@theaudiosmith.com',   '(214) 555-0119', 'A1',        750),
      ('Elias Vance',     'dan+elias@theaudiosmith.com',    '(214) 555-0120', 'V1',        700),
      ('Rosa Delacruz',   'dan+rosa@theaudiosmith.com',     '(214) 555-0121', 'LD',        725),
      ('Tobias Kerr',     'dan+tobias@theaudiosmith.com',   '(214) 555-0122', 'LD',        725)
    ) as t(person, email, phone, role, rate)
  loop
    insert into crew_members (organization_id, full_name, email, phone)
    select v_org, p.person, p.email, p.phone
    where not exists (
      select 1 from crew_members c where c.organization_id = v_org and c.full_name = p.person);

    select c.id into v_crew from crew_members c
      where c.organization_id = v_org and c.full_name = p.person;

    -- A rate card is what the picker reads to know somebody DOES this job: no
    -- card, no candidate. The day_rate on it is the directory default; the
    -- show's own rate is decided by the show-wide trigger at staffing time.
    insert into rate_cards (crew_member_id, role, day_rate)
    select v_crew, p.role, p.rate
    where not exists (
      select 1 from rate_cards rc where rc.crew_member_id = v_crew and rc.role = p.role);
  end loop;

  ------------------------------------------------------------- the clash show
  delete from shows where organization_id = v_org and name = v_name;

  -- SENT TO SCHEDULING, and that is load-bearing rather than decoration: the
  -- picker's conflict query runs under the CALLER's own RLS, and a scheduler
  -- sees a show only once it has been sent. Record the demo as Sasha with this
  -- show unsent and no warning appears at all — the app being right while the
  -- demo looks broken.
  insert into shows (organization_id, name, venue, city_state, client_company,
                     job_number, start_date, end_date, timezone_identifier,
                     show_financials, created_by, show_notes,
                     sent_to_scheduling_at, sent_to_scheduling_by)
  values (v_org, v_name, 'Renaissance Dallas', 'Dallas, TX', 'Lakeshore Capital',
          'CT-2611', v_clash, v_clash + v_clash_days, 'America/Chicago', true, v_dan,
          'Demo show. Exists so the Oct 1-5 sheet has real clashes to warn about.',
          now() - interval '8 days', v_dan)
  returning id into v_show;

  insert into payroll_rulesets (show_id, overtime_after_hours, double_time_enabled,
    double_time_after_hours, meal_penalty_enabled, meal_penalty_grace_period,
    meal_penalty_amount, minimum_meal_break_enabled, minimum_meal_break_minutes,
    meal_break_deduction_cap, short_turn_penalty_enabled, short_turn_rest_hours,
    cancellation_pay_percent)
  values (v_show, 10, true, 12, true, 6, 25, true, 30, 60, true, 10, 50);

  for d in 0..v_clash_days loop
    insert into work_days (show_id, date, day_number, activities)
    values (v_show, v_clash + d, d + 1,
            case d when 0 then array['load_in']
                   when v_clash_days then array['show','load_out']
                   else array['show'] end);
  end loop;

  insert into rooms (work_day_id, name)
  select wd.id, 'Grand Ballroom' from work_days wd where wd.show_id = v_show;

  -- ONE PER ROLE DAN IS FILLING, so every line of his sheet meets a clash —
  -- and never more than one, so every line still has somebody free. Confirmed,
  -- because the warning reads "Already scheduled on…" only for a held date;
  -- somebody who has merely been asked is not yet unavailable.
  --
  -- Leaves free: BO Tech — Hana, Desmond, Lucia, Owen (he needs 3) · A1 — Chris,
  -- Bianca · V1 — Jordan, Elias · LD — Marcus, Rosa · Stagehand — Dana, Ruth,
  -- Miles.
  --
  -- ALEX REYES holds the A1 here rather than Chris Ferraro (Dan, 2026-09-16:
  -- "Switch Alex for Chris on the Lakeshore investor day. It will help my
  -- script"). Alex is the name the demo's crew login is linked to, so he is the
  -- person the script already says out loud.
  --
  -- NO position_defs and nobody waiting, so this show has no open slot, nobody
  -- unanswered and no flag — which is what keeps it off the Needs-scheduling
  -- queue the demo is about to look at.
  for b in
    select * from (values
      ('Farrah Nasser',  'BO Tech'),
      ('Gil Tran',       'BO Tech'),
      ('Alex Reyes',     'A1'),
      ('Sam Whitfield',  'V1'),
      ('Tobias Kerr',    'LD'),
      ('Nina Brennan',   'Stagehand')
    ) as t(person, role)
  loop
    select c.id into v_crew from crew_members c
      where c.organization_id = v_org and c.full_name = b.person;
    if v_crew is null then
      raise exception 'Seed the main demo first: % is not in the directory.', b.person;
    end if;
    select rc.day_rate into v_rate from rate_cards rc
      where rc.crew_member_id = v_crew and rc.role = b.role;

    for v_day in select id from work_days where show_id = v_show order by day_number loop
      select id into v_room from rooms where work_day_id = v_day.id;
      insert into timecards (room_id, crew_member_id, crew_member_name, role, day_rate,
                             booking_status, booking_invited_at, booking_responded_at)
      values (v_room, v_crew, b.person, b.role, v_rate, 'confirmed',
              now() - interval '7 days', now() - interval '6 days');
    end loop;
  end loop;

  raise notice 'Availability seeded. Clash show % runs % to % (week is % to %)',
    v_show, v_clash, v_clash + v_clash_days, v_start, v_start + 4;
end $$;

-- Who can work Dan's week, by role, and who cannot.
select rc.role,
       count(*) filter (where busy.crew_member_id is null) as free,
       count(*) filter (where busy.crew_member_id is not null) as booked_elsewhere,
       string_agg(c.full_name || case when busy.crew_member_id is not null then ' (busy)' else '' end,
                  ', ' order by c.full_name) as who
from crew_members c
join rate_cards rc on rc.crew_member_id = c.id
left join (
  select distinct t.crew_member_id
  from timecards t join shows s on s.id = t.show_id
  where s.name = 'Lakeshore Investor Day' and t.booking_status <> 'declined'
) busy on busy.crew_member_id = c.id
where c.organization_id = 'e24655eb-5514-42d3-b248-3a879677dde9'
  and rc.role in ('BO Tech', 'A1', 'V1', 'LD', 'Stagehand')
group by rc.role order by rc.role;
