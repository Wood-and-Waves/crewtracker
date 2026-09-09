-- Whose days changed without anybody telling them.
--
-- staffing_events already has `sent_at`, and it does NOT mean this: that stamp
-- is set by app/api/digest when the row appears in the PM's evening digest.
-- Telling the CREW MEMBER is a different act, a different audience and a
-- different day, so it gets its own stamp. Reusing sent_at would make the
-- digest silently mark people as told.
--
-- Dan, 2026-09-09: the prompt to tell somebody lives in the page you happen to
-- be on and dies when you navigate away, so a person's days can change and
-- nobody ever finds out that nobody told them.
--
-- No grant needed: `authenticated` holds a TABLE-level SELECT here, which
-- covers columns added later. (timecards is the exception in this schema — it
-- is column-granted, for the day_rate lockdown.)
--
-- WRITES EXISTING ROWS. Every event already in the table is backfilled as
-- told. Without that, the first time anybody opens the Scheduling screen they
-- meet a list of every change ever made — history nobody can act on, which
-- teaches them to ignore the number on day one.

alter table public.staffing_events
  add column if not exists crew_told_at timestamptz;

comment on column public.staffing_events.crew_told_at is
  'The crew member was told their days changed. Null = nobody has told them. NOT sent_at, which is the PM''s evening digest.';

-- The backfill: everything before this migration counts as told.
update public.staffing_events set crew_told_at = at where crew_told_at is null;

-- Read by the Scheduling screen for one show at a time, always filtered to the
-- untold rows. Partial, because the told rows are the overwhelming majority
-- and are never the ones being looked for.
create index if not exists staffing_events_untold_idx
  on public.staffing_events (show_id)
  where crew_told_at is null;
