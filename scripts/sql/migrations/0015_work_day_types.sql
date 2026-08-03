-- What each day of a show IS: travel, load-in, rehearsal, show, load-out.
--
-- WHY
-- ---
-- A run is not a uniform block of days. "Jul 28 – Aug 4" tells a scheduler
-- nothing about which of those days is a full show and which is a truck and a
-- hotel, and it is the first thing a crew member asks when deciding whether
-- they can take the job.
--
-- The app already fakes this and gets it wrong: components/CrewCallGrid.tsx
-- labels the first day column "load in" and the last "load out" purely because
-- of their position, which is false the moment a run opens with a travel day or
-- ends with two days of load-out. This replaces a guess with a stated fact.
--
-- HARD RULE: day_type IS PLANNING INFORMATION AND NOTHING ELSE. It is never
-- read by lib/payroll.ts and it never appears on TimecardLike. What somebody
-- gets paid is decided PER PERSON PER DAY by timecards.is_travel_day /
-- travel_in_day / travel_out_day, which already exist and are not touched here.
--
-- The two are not duplicates and must not be merged. On a Travel/Load-in day
-- some crew travel only, some travel and then work a full day, and some live in
-- town and just turn up — one show-wide label cannot express that. Migration
-- 0012 drew exactly this line around booking_status ("a scheduling state must
-- never quietly decide what somebody gets paid"); it held there and it holds
-- here for the same reason.
--
-- WHY text + CHECK RATHER THAN AN ENUM TYPE
-- -----------------------------------------
-- The house pattern — punches.punch_type and timecards.booking_status are both
-- text with a CHECK, and there is not one CREATE TYPE in this schema. Adding an
-- eighth kind of day is then an ALTER of this constraint rather than a type
-- alteration, and the ordering that actually matters (show chronology, for the
-- dropdown) lives in lib/dayTypes.ts where it can be rearranged without
-- touching the database at all.
--
-- WHY NULLABLE, WITH NO DEFAULT
-- -----------------------------
-- Every work day that exists right now genuinely has no day type, and inventing
-- one would print a false label on the tracker and, worse, into a booking
-- request email sent to a crew member. NULL means "nobody has said yet" and
-- renders as blank.
--
-- add_show_day() is deliberately NOT changed. A day appended to the end of a
-- run is most often a load-out, so copying the previous day's type would
-- confidently stamp "Show" on it. Leaving it NULL is the correct behaviour, not
-- an oversight — saying so here because "we didn't touch the function" reads
-- like an omission otherwise.

alter table public.work_days
  add column if not exists day_type text;

-- Written as an explicit `is null or` rather than leaning on three-valued logic.
-- `check (day_type in (...))` would also admit NULL — the comparison is unknown
-- and a CHECK only fails on FALSE — but nobody reading this should have to know
-- that to see that a blank day type is allowed on purpose.
alter table public.work_days
  drop constraint if exists work_days_day_type_check;
alter table public.work_days
  add constraint work_days_day_type_check check (
    day_type is null or day_type in (
      'travel_load_in',
      'load_in',
      'load_in_show',
      'rehearsal',
      'show',
      'load_out_travel',
      'travel'
    )
  );

-- BOTH HALVES OR NEITHER — the grant AND the policy.
--
-- work_days has no UPDATE policy and no UPDATE grant. Migration 0007 revoked
-- the grant precisely because an UPDATE that matches no policy affects ZERO
-- ROWS AND RETURNS SUCCESS: the app sees no error, reports "saved", and nothing
-- happened. This project has already had that exact bug on this exact table — a
-- work day deleted through the app reported success and changed nothing, and it
-- took a long time to find because there was no error to look at.
--
-- The day type is editable after the show is created, so it needs both. Ship
-- the grant without the policy and the silent-success bug is back.
--
-- The grant is COLUMN-LEVEL on purpose: day_type becomes the only thing on a
-- work day the app can ever change, so no future code can quietly rewrite a
-- date or a day number through this same door.
grant update (day_type) on table public.work_days to authenticated;

-- Mirrors the existing INSERT policy on this table word for word, so the rule
-- for changing a day is the same as the rule for creating one. It points at
-- `shows`, and `shows` does not point back at `work_days`, so this cannot
-- reproduce the RLS recursion incident — that needed two tables' policies
-- referencing each other.
drop policy if exists "Users set day type on their org shows" on public.work_days;
create policy "Users set day type on their org shows"
  on public.work_days for update
  using (
    show_id in (
      select shows.id from public.shows
      where shows.organization_id = public.my_organization_id()
    )
  )
  with check (
    show_id in (
      select shows.id from public.shows
      where shows.organization_id = public.my_organization_id()
    )
  );

-- DO NOT run `npm run db:grants` yet.
--
-- It reads PRODUCTION, and production is still at 0010. Running it today would
-- regenerate scripts/sql/grants.sql from a database that has none of 0011-0015,
-- silently dropping the grant above (and 0012's column grants, which are
-- already missing from the checked-in file for this same reason).
--
-- Re-run it only after 0011-0015 have been applied with --prod.
