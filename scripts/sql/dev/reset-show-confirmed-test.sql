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
select 'http://localhost:3000/book/' || token as crew_link
  from booking_invites where show_id = '596ea309-8d69-416c-8da0-b32825c7af84';
