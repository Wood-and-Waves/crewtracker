-- WHO THE CREW CALL WHEN SOMETHING IS WRONG, on the show.
--
-- Dan, 2026-09-20: "What if we added a PM contact information on the
-- individual time card. That could be helpful. Mobile tapable." A crew member
-- looking at a dead punch cell, or standing at the wrong dock, has no way from
-- that screen to reach anybody.
--
-- PER SHOW, not per person, which was Dan's call when asked. The number a crew
-- member needs is whoever is ON SITE that week, and that is not always the
-- show's app-level PM (shows.pm_profile_id, which is about ACCESS and an
-- invitation). Keeping it here means a production office can put the
-- floor lead's mobile on the sheet without giving them a login.
--
-- NOTHING IS WRITTEN TO EXISTING ROWS. Both columns are nullable and a show
-- without them shows no contact block at all.
--
-- `shows` is TABLE-granted, so the new columns inherit SELECT/UPDATE and need
-- no explicit column grant (unlike timecards, where the day_rate lockdown
-- makes grants column-level and a new column is invisible until named).
-- Verified with has_table_privilege before writing this.

alter table public.shows add column if not exists onsite_contact_name  text;
alter table public.shows add column if not exists onsite_contact_phone text;

comment on column public.shows.onsite_contact_name is
  'Who the crew ring on this show. Shown on the crew clock screen; falls back to nothing.';
comment on column public.shows.onsite_contact_phone is
  'Their mobile, as typed. Rendered as tel: and sms: links on the crew clock screen.';
