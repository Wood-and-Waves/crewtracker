-- PUTS "Test Show 3" ON DEV BACK TO THE START OF THE SHOW-CONFIRMED WALKTHROUGH.
--
--   npm run db:sql -- scripts/sql/dev/reset-show-confirmed-test.sql
--
-- The walkthrough is one-way — marking a show confirmed and telling the crew
-- cannot be un-pressed in a way that leaves the fixture as it was — so this
-- exists to make the test repeatable rather than a thing you get one go at.
--
-- IT IS DEV-ONLY BY CONSTRUCTION. The show id below exists on the dev database
-- and nowhere else, and the block RAISES if it is missing rather than quietly
-- doing nothing, so pointing this at production fails loudly instead of looking
-- like it worked.
--
-- THE THREE PEOPLE ARE THE POINT. Each one proves a different half of the rule:
--
--   Ines Dubois     ACCEPTED   -> "The dates you accepted are now firm." No buttons.
--   Bex Petrov      ASKED      -> "Please accept or decline." Both buttons, live link.
--   Noor Halvorsen  NOT ASKED  -> receives NOTHING. Nobody has contacted her, so
--                                 she has no hold to upgrade, and telling her a
--                                 job is confirmed would be the first she ever
--                                 heard of it.
--
-- So a correct run sends exactly TWO emails, both to DEV_EMAIL_TO.

do $$
declare
  v_show constant uuid := '596ea309-8d69-416c-8da0-b32825c7af84';  -- Test Show 3 (dev)
  v_bex  constant uuid := 'c819fa11-bf13-4796-a5fc-d85d5a7c227b';
  v_ines constant uuid := 'b170a50a-4b32-46cc-b38f-a244b2e67062';
  v_name text;
  v_room uuid;
begin
  select name into v_name from shows where id = v_show;
  if v_name is null then
    raise exception 'Test Show 3 is not in this database — this fixture is for DEV only.';
  end if;

  -- THE SHOW IS ALWAYS NEXT WEEK (Dan, 2026-10-01: "Let's change the test show
  -- to be future. No reason to go after a past show and fix it."). It was
  -- seeded in the past, which made every booking request refuse: the link
  -- expires the day after the show, so on a finished show it is dead before it
  -- is sent, and "Send email invites" correctly declined to send anything.
  --
  -- Dated from current_date rather than shifted by a fixed offset, so running
  -- this twice does not walk the show further into the future each time.
  update work_days w
     set date = (current_date + 7) + (w.day_number - 1)
   where w.show_id = v_show;
  update shows
     set start_date = (select min(date) from work_days where show_id = v_show),
         end_date   = (select max(date) from work_days where show_id = v_show)
   where id = v_show;

  -- Held, and nobody told. This is what puts NOT CONFIRMED on the shows list
  -- and the Scheduling strip, and makes the fill picker say PENCIL.
  update shows
     set confirmed_at = null, confirmed_by = null, confirmed_notice_sent_at = null
   where id = v_show;

  update timecards set booking_status = 'confirmed' where show_id = v_show and crew_member_id = v_ines;
  update timecards set booking_status = 'invited'   where show_id = v_show and crew_member_id = v_bex;
  update timecards set booking_status = 'pencilled'
   where show_id = v_show and crew_member_id not in (v_ines, v_bex);

  -- Bex needs a LIVE link, or her email correctly drops the buttons and the
  -- "please accept or decline" line with them.
  insert into booking_invites (show_id, crew_member_id, email, token, expires_at, sent_at)
  select v_show, v_bex, email, gen_random_uuid(), now() + interval '20 days', now()
    from crew_members where id = v_bex
  on conflict (show_id, crew_member_id) do update
    set token = gen_random_uuid(), expires_at = now() + interval '20 days',
        responded_at = null, response = null;

  -- Two open slots on the first room-day, so the fill picker has somewhere to
  -- work. position_def_id null = a one-off slot, which sync_position_slots()
  -- leaves alone, so this cannot fight the show's definitions.
  select r.id into v_room
    from rooms r join work_days w on w.id = r.work_day_id
   where r.show_id = v_show order by w.date, r.created_at limit 1;
  delete from crew_call_positions where room_id = v_room and position_def_id is null;
  insert into crew_call_positions (room_id, role)
  select v_room, x.role from (values ('A1'), ('Stagehand')) as x(role);

  raise notice 'Test Show 3 reset: held, nobody told, 2 open slots.';
end $$;

-- Bex's link for step 1. Open it BEFORE marking the show confirmed — that page
-- is the whole point of the hold wording, and confirming changes what it says.
--
-- Both hosts, because the same dev database is behind the local server AND the
-- branch preview, and which one you are testing on is your choice rather than
-- something this file can know.
-- NAMED, because this show has collected invites from earlier runs and an
-- unlabelled column of four links tells you nothing about which one to open.
-- Bex is the one the walkthrough wants: she is the person who was asked and has
-- not answered, so hers is the page that carries the hold wording.
select
  c.full_name,
  'http://localhost:3000/book/' || b.token as local_url,
  'https://crewtracker-git-scheduling-crew-tracker.vercel.app/book/' || b.token as preview_url
  from booking_invites b
  join crew_members c on c.id = b.crew_member_id
 where b.show_id = '596ea309-8d69-416c-8da0-b32825c7af84'
   and b.expires_at > now()
 order by (c.id = 'c819fa11-bf13-4796-a5fc-d85d5a7c227b') desc, c.full_name;
