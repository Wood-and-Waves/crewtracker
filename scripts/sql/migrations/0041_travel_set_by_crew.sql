-- Who said this was a travel day.
--
-- Dan, 2026-09-17: "There is not a way to mark a day as travel in the crews log
-- page. I have to do it as PM." Crew are about to be able to say it themselves,
-- and a claim somebody makes about their own day has to be attributable — the
-- same bargain `punches.source` already strikes, and for the same reason. Every
-- crew-entered punch is marked on the tracker so the PM can see who claimed
-- what; without this column a crew-set travel day would appear on the sheet
-- looking exactly like one the PM set, and the PM would be reviewing changes
-- they cannot tell from their own.
--
-- It also decides who may UNDO it, which is the rule the crew clock already
-- runs on: crew may change what they entered, never what the PM entered.
--
-- IT IS ATTRIBUTION ONLY. lib/payroll.ts must never read it — a travel day is
-- worth what a travel day is worth, whoever wrote it down, and the moment the
-- calculator can tell them apart somebody will make it pay differently. Exactly
-- the rule that governs punches.source.
--
-- `staff` is the default so every timecard that already exists is correct: the
-- only way a flag got set until today was a PM setting it.
--
-- COLUMN GRANT REQUIRED. timecards is the one column-granted table in this
-- schema (the day_rate lockdown), so a new column is invisible to
-- `authenticated` until it is granted by name — the same step 0023 and 0027
-- each had to take. No UPDATE grant: the app never writes this from a browser
-- session. The crew route writes it with the service role, and the PM's own
-- flag pills leave it alone (a PM setting a flag through their session is
-- `staff`, which is the default).
--
-- WRITES NO EXISTING ROWS.

alter table public.timecards
  add column if not exists travel_source text not null default 'staff'
  check (travel_source in ('staff', 'crew'));

grant select (travel_source) on public.timecards to authenticated;

comment on column public.timecards.travel_source is
  'Who set this day''s travel flags: staff (a PM, the default) or crew (the person themselves, from their own clock link). Attribution only — payroll must never read it.';
