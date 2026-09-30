-- TELLING THE CREW IS A SEPARATE PRESS FROM MARKING THE SHOW CONFIRMED.
--
-- Dan, 2026-09-30: "I think we need a second button to press to email the crew.
-- Sending an autoemail when the mark show as confirmed get hit feels too risky."
--
-- He is right, and it matches how everything else outward-facing in this app
-- already works: the crew change notice is OFFERED and never automatic, and so
-- is telling somebody they were removed. Marking a show confirmed is an
-- INTERNAL bookkeeping fact — the scheduler starts booking instead of holding —
-- and it should not be the same gesture as writing to thirty freelancers. A
-- toggle pressed to see what it does must not reach a single real person.
--
-- So 0042's confirmed_at goes back to being only what it says, and this column
-- records the other thing: when the crew were actually told.
--
-- WHY A STAMP RATHER THAN JUST A BUTTON. Without one the button looks identical
-- before and after it is pressed, so nobody can tell whether the crew know —
-- which is the exact problem staffing_events.crew_told_at was added to solve in
-- 0040. It also lets the button stay available for a deliberate second send
-- (somebody booked after the first notice went out) while SAYING when the last
-- one went, so pressing it again is a choice rather than an accident.
--
-- BACKFILLED AS ALREADY TOLD, and this is the trap. 0042 stamped every existing
-- show as confirmed, so leaving this null would put a "Tell the crew" button on
-- every show in the database — including finished and finalized ones — inviting
-- somebody to email a year of history about jobs that are long over. Same
-- reasoning as 0040, "so the screen does not open on a year of history nobody
-- can act on."
--
-- NO COLUMN GRANT NEEDED. `shows` is TABLE-granted; proven by 0041 and again by
-- 0042, where db:grants came back a header-only diff.

alter table public.shows add column if not exists confirmed_notice_sent_at timestamptz;

-- Everything that existed before this column predates the button, so nobody is
-- going to be told about it now. confirmed_at rather than now(), so the row
-- carries an honest date.
update public.shows
   set confirmed_notice_sent_at = confirmed_at
 where confirmed_notice_sent_at is null
   and confirmed_at is not null;

comment on column public.shows.confirmed_notice_sent_at is
  'When the crew were last emailed that this show is confirmed. Null = confirmed but nobody told them, which is what puts the Tell the crew button on screen. Cleared when a show goes back to holding dates. NOT confirmed_at, which is the internal fact that the client sold it.';
