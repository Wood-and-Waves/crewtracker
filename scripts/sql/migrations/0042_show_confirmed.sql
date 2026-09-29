-- IS THIS SHOW SOLD, OR ARE WE HOLDING THE DATES?
--
-- Dan, 2026-09-29: "A pencil vs book option for the scheduler. Pencil is for
-- when a show isn't confirmed yet, but the company is asking for a hold. Book
-- is for when a show is confirmed."
--
-- The app has never known the difference, so a scheduler asking somebody to
-- hold October had to say so by hand in every message, and every show looked
-- equally real on the sheet.
--
-- ONE FLAG, NOT TWO STATES. `confirmed_at` null means the job is not sold yet.
-- There is deliberately no stored word for that: the UI carries a single "Show
-- Confirmed" toggle, and "pencil" appears only as the VERB on the scheduler's
-- button. Dan: "Lets make it a 'Show Confirmed' toggle box ... and not write
-- 'penciled'."
--
-- THIS IS NOT booking_status. That column is the CREW MEMBER's answer to being
-- asked (not asked / asked / accepted / declined); this is the show's standing
-- with the CLIENT. One person can be accepted on a show nobody has sold. The
-- two must never be folded together, and nothing copies this onto a timecard —
-- the show's state is read where it is displayed, so the two cannot drift.
--
-- WRITES EXISTING ROWS, ON PURPOSE. Null means not confirmed, so without the
-- backfill every show ever created — including finished and finalized ones —
-- would suddenly read as a hold and the crew screens would start offering to
-- confirm history. Every existing show predates the concept and was real, so
-- they are all stamped. Same reasoning as 0040 backfilling `crew_told_at`, "so
-- the screen does not open on a year of history nobody can act on."
--
-- NO COLUMN GRANT NEEDED. `shows` is TABLE-granted — proven when 0041 added the
-- on-site contact and `npm run db:grants` came back a header-only diff. Unlike
-- `timecards`, where the day_rate lockdown makes every grant column-level and a
-- new column is invisible until it is named.

alter table public.shows add column if not exists confirmed_at timestamptz;
alter table public.shows add column if not exists confirmed_by uuid references public.profiles(id);

-- created_at rather than now(), so a show carries an honest date rather than
-- the date of this migration.
update public.shows set confirmed_at = created_at where confirmed_at is null;

comment on column public.shows.confirmed_at is
  'When the client confirmed this show. Null = holding the dates, so the scheduler pencils rather than books. NOT timecards.booking_status, which is the crew member''s own answer.';
comment on column public.shows.confirmed_by is
  'Who turned the Show Confirmed toggle on. Null on rows stamped by the 0042 backfill.';
