-- A PM works the SHOW, not a room — and had nowhere to stand.
--
-- Dan, 2026-09-15: "Production manager doesnt always belong to a room, but
-- needs to track time. How can we differentiate if they are over all and not in
-- a room?" And 2026-09-17: "How can we have a PM not in a room and still on a
-- timecard?"
--
-- Hours live on `timecards`, and a timecard hangs off a ROOM (`room_id`, not
-- null). A room is scoped to one day of one show. So "on the show but not in a
-- room" has had nowhere to exist, while everything downstream — payroll
-- grouping, the by-day reports, the crew clock, the venue QR's pick-a-room
-- step — assumes the room is there.
--
-- Three ways out were put to Dan and he chose the third:
--   1. A room literally called "Production". Free, and a lie that then appears
--      in every report and on the printed QR sign forever.
--   2. Make room_id nullable. Honest, and it touches every reader of a
--      timecard in the app — the wide, quiet kind of change that breaks
--      payroll grouping six weeks later on somebody's real show.
--   3. THIS. The room still exists, so nothing downstream changes and payroll
--      and reports keep working exactly as they do; it is FLAGGED as belonging
--      to the whole show rather than to a space, so the screens that list
--      rooms can say "Whole show" instead of printing an invented name, and
--      the QR sign can skip it.
--
-- The test any design here had to pass is Dan's own second question: a PM over
-- the Plenary ONLY is already expressible — that is just a timecard in the
-- Plenary with the PM role — so this must not make the room-specific case
-- harder than the show-wide one. It does not: a show-wide room is an ordinary
-- room wearing one flag.
--
-- THIS IS NOT shows.pm_profile_id. That is about ACCESS and an invitation.
-- This is about HOURS and pay. One person can hold both and they must never be
-- conflated — and a show can carry more than one of these (a PM and a
-- producer), which is why it cannot be a field on `shows`.
--
-- No grant needed: `authenticated` holds a TABLE-level grant on rooms, which
-- covers columns added later. (timecards is the exception in this schema — it
-- is column-granted, for the day_rate lockdown.)
--
-- WRITES NO EXISTING ROWS. Every room already in the database is a real room
-- and stays one; the default says so.

alter table public.rooms
  add column if not exists is_show_wide boolean not null default false;

-- AT MOST ONE PER DAY. The show-wide room is a singleton by construction, so
-- two of them cannot be created by two people pressing at once — the second
-- insert is refused by the database rather than leaving a show with two
-- "Whole show" rooms that split one person's hours between them.
create unique index if not exists rooms_one_show_wide_per_day
  on public.rooms (work_day_id)
  where is_show_wide;

comment on column public.rooms.is_show_wide is
  'This "room" is the whole show, not a space: somebody staffed on the show without being in a room (a PM, a producer). Readers label it "Whole show" and the venue QR skips it.';
