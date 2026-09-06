-- Flatten the RLS chain: every table under a show learns its show_id.
--
-- ⚠ THIS FILE WRITES EXISTING ROWS. It backfills a new column on rooms,
-- timecards and punches (every row in all three), and to do that it
-- TEMPORARILY DISABLES the two finalized-show write blocks inside the
-- transaction — otherwise the backfill is refused on any finalized show. Both
-- triggers are re-enabled before commit; the transaction wrapper db-migrate
-- adds means a failure anywhere leaves nothing half-done. Take a backup first
-- (npm run db:dump), as the procedure in CLAUDE.md says.
--
-- WHY
-- ---
-- After 0021 the per-row helper calls are gone, but reading one show's punches
-- as a signed-in user still costs ~6 ms planning + ~17 ms execution on dev
-- (0.27 ms with RLS off) and scans `shows` eight times: the policies delegate
-- punches → timecards → rooms → work_days → shows, and every level re-derives
-- the one above. A single punch UPDATE walks that chain three times. At
-- roughly eight such statements per tracker view, that is the lag left.
--
-- WHAT
-- ----
-- The exact precedent of show_assignments.organization_id (the 2026-07 RLS
-- recursion fix): denormalize the key the policy needs onto the row, keep it
-- true with a BEFORE trigger, and make each policy one level deep —
-- `show_id in (select id from shows)`. Every subquery is still RLS-filtered
-- as the caller, so the visible set is exactly what the five-level chain
-- produced; the chain simply is not re-derived per level.
--
-- NO HOLE OPENED. No permission term is removed. The one vector this file
-- introduces — a client setting show_id, or re-pointing timecard_id/room_id at
-- another company's row — is closed by the triggers firing on UPDATE OF those
-- columns too (a direct REST call cannot re-label a row; the trigger overwrites
-- whatever was sent) plus WITH CHECK on the resulting show_id. Pinned by
-- scripts/test/rls.mts.
--
-- NO RECURSION. punches/timecards/rooms/work_days → shows → show_assignments →
-- (functions only). Nothing points back. The triggers are SECURITY DEFINER
-- functions, not policies.
--
-- Trigger ordering (BEFORE ROW triggers fire alphabetically): on punches,
-- punches_blocked_when_finalized runs before set_punch_show_id; on timecards,
-- set_timecard_show_id runs before every timecards_* trigger. Nothing reads
-- NEW.show_id today, so neither order matters yet — recorded so it is not
-- rediscovered.
--
-- AFTER THIS FILE, ON PRODUCTION: `npm run db:grants` (new column grant on
-- timecards) and `npm run db:schema` (schema.sql is already stale, pre-0013).

-- 1. Columns. FK cascade so a show delete never conflicts with the chain
--    cascade it already has.
alter table public.rooms     add column if not exists show_id uuid references public.shows(id) on delete cascade;
alter table public.timecards add column if not exists show_id uuid references public.shows(id) on delete cascade;
alter table public.punches   add column if not exists show_id uuid references public.shows(id) on delete cascade;

-- 2. Backfill as owner (RLS does not apply to the migration role).
--    timecards_check_pay_rate_permission returns early when auth.uid() is null
--    and day_rate is unchanged; timecards_propagate_show_day_rate is
--    AFTER UPDATE OF day_rate and does not fire. Only the finalized blocks
--    need lifting.
alter table public.timecards disable trigger timecards_blocked_when_finalized;
alter table public.punches   disable trigger punches_blocked_when_finalized;
update public.rooms r     set show_id = w.show_id from public.work_days w where w.id = r.work_day_id and r.show_id is null;
update public.timecards t set show_id = r.show_id from public.rooms r     where r.id = t.room_id     and t.show_id is null;
update public.punches p   set show_id = t.show_id from public.timecards t where t.id = p.timecard_id and p.show_id is null;
alter table public.timecards enable trigger timecards_blocked_when_finalized;
alter table public.punches   enable trigger punches_blocked_when_finalized;
alter table public.rooms     alter column show_id set not null;
alter table public.timecards alter column show_id set not null;
alter table public.punches   alter column show_id set not null;

-- 3. Keep it true. Same shape as set_show_assignment_organization_id():
--    SECURITY DEFINER so the parent lookup ignores RLS; BEFORE INSERT OR UPDATE
--    OF the parent key AND show_id itself. BEFORE triggers run before NOT NULL
--    and WITH CHECK — the proven order behind show_assignments.organization_id.
create or replace function public.set_room_show_id() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  select w.show_id into new.show_id from work_days w where w.id = new.work_day_id;
  return new;
end; $$;
drop trigger if exists set_room_show_id on public.rooms;
create trigger set_room_show_id before insert or update of work_day_id, show_id on public.rooms
  for each row execute function public.set_room_show_id();

create or replace function public.set_timecard_show_id() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  select r.show_id into new.show_id from rooms r where r.id = new.room_id;
  return new;
end; $$;
drop trigger if exists set_timecard_show_id on public.timecards;
create trigger set_timecard_show_id before insert or update of room_id, show_id on public.timecards
  for each row execute function public.set_timecard_show_id();

create or replace function public.set_punch_show_id() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  select t.show_id into new.show_id from timecards t where t.id = new.timecard_id;
  return new;
end; $$;
drop trigger if exists set_punch_show_id on public.punches;
create trigger set_punch_show_id before insert or update of timecard_id, show_id on public.punches
  for each row execute function public.set_punch_show_id();

-- 4. Indexes: the FK cascade, and direct reads by show.
create index if not exists rooms_show_id_idx     on public.rooms (show_id);
create index if not exists timecards_show_id_idx on public.timecards (show_id);
create index if not exists punches_show_id_idx   on public.punches (show_id);

-- 5. Grants. timecards is COLUMN-granted (the day_rate lockdown), so the new
--    column is invisible to the app until granted. SELECT only — the trigger
--    owns the value, and the app never sends it. rooms and punches are
--    table-granted and need nothing.
grant select (show_id) on public.timecards to authenticated;

-- 6. Policies: one level. `alter policy` so a wrong name fails loudly.
alter policy "Users see rooms for their shows"            on public.rooms using (show_id in (select id from shows));
alter policy "Users create rooms for their org shows"     on public.rooms with check (show_id in (select id from shows));
alter policy "rooms_update_own_org"                       on public.rooms using (show_id in (select id from shows)) with check (show_id in (select id from shows));
alter policy "rooms_delete_own_org"                       on public.rooms using (show_id in (select id from shows));

-- work_days already carried show_id; these two just drop the per-row
-- `organization_id = my_organization_id()` inside their subquery, which the
-- shows SELECT policy applies anyway.
alter policy "Users create work days for their org shows" on public.work_days with check (show_id in (select id from shows));
alter policy "Users set day type on their org shows"      on public.work_days using (show_id in (select id from shows)) with check (show_id in (select id from shows));

alter policy "Users see timecards for their shows"        on public.timecards using (show_id in (select id from shows));
alter policy "Timecard editors create timecards"          on public.timecards with check (show_id in (select id from shows) and (select my_perm('can_edit_timecards')));
alter policy "Timecard editors update timecards"          on public.timecards using (show_id in (select id from shows) and (select my_perm('can_edit_timecards')));
alter policy "Timecard editors delete timecards"          on public.timecards using (show_id in (select id from shows) and (select my_perm('can_edit_timecards')));

alter policy "Users see punches for their timecards"      on public.punches using (show_id in (select id from shows));
alter policy "Timecard editors create punches"            on public.punches with check (show_id in (select id from shows) and ((select my_perm('can_edit_timecards')) or is_own_timecard(timecard_id)));
alter policy "Timecard editors update punches"            on public.punches using (show_id in (select id from shows) and ((select my_perm('can_edit_timecards')) or is_own_timecard(timecard_id)));
alter policy "Timecard editors delete punches"            on public.punches using (show_id in (select id from shows) and ((select my_perm('can_edit_timecards')) or is_own_timecard(timecard_id)));

-- Left alone on purpose: crew_call_positions (not on the punch path; it now
-- nests two levels instead of five with no change here), block_writes_when_
-- finalized (also serves crew_call_positions, which has no show_id), and the
-- timecard_day_rates view (SECURITY DEFINER with its own visibility rule; it
-- could drop two joins via t.show_id, but that is a change for its own file).
