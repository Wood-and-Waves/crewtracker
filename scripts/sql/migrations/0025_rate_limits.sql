-- Rate limiting for the three public write endpoints.
--
-- WHY IN THE DATABASE. The app runs on Vercel, where a route can be served by
-- several separate instances that share no memory, so an in-process counter
-- would reset whenever a request landed on a fresh instance — exactly the
-- moment a flood of requests would create fresh instances. The Hobby plan has
-- no platform rate limiting. The one thing every instance already shares is
-- this database, and every one of these routes already makes a round trip to
-- it, so one more cheap upsert is the honest floor.
--
-- WHAT IT PROTECTS (CLAUDE.md security backlog, 2026-09-04):
--   /api/bookings/respond — replayable, and each decline re-sends an email, so
--                           a leaked link was an inbox-flood button;
--   /api/clock/punch and /api/clock/identify — public writes, same exposure.
-- Nothing else in the app had any throttle at all.
--
-- HOW. rate_limit_hit(key, limit, window) counts hits per key inside a fixed
-- window and answers "is this one allowed?". The caller picks the key — a
-- token, an IP, or both — and the limits; see lib/rateLimit.ts. Fixed windows
-- rather than sliding: simpler, and a burst of 2× at a window edge is fine for
-- a throttle whose job is to stop thousands, not to be exact.
--
-- ACCESS. The table gets RLS from the ensure_rls event trigger and has NO
-- policies, so no browser session can read or write it. The function is
-- SECURITY DEFINER (it must write that table) and is therefore REVOKED from
-- anon and authenticated: only the service role — the API routes — may call
-- it. Otherwise anyone holding the public anon key could call it directly and
-- burn other people's quota. NOTE for a rebuild: db:grants captures table
-- privileges, not function ones, so this REVOKE is an absence a rebuild from
-- schema.sql would lose (see CLAUDE.md, "Revoked privileges"). Losing it is a
-- nuisance (quota abuse), never a data leak — the table holds counters.
--
-- HOUSEKEEPING. Rows are tiny and keyed per token/IP; the keepalive cron
-- deletes windows older than a day so the table never grows past the last
-- day's traffic.

create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);
-- ensure_rls force-enables RLS on every new table; said explicitly anyway so
-- the file does not depend on an event trigger being present.
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  insert into rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
                  when r.window_start < now() - make_interval(secs => p_window_seconds) then 1
                  else r.count + 1
                end,
        window_start = case
                  when r.window_start < now() - make_interval(secs => p_window_seconds) then now()
                  else r.window_start
                end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant  execute on function public.rate_limit_hit(text, integer, integer) to service_role;
