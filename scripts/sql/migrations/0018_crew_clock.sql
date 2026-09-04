-- Crew punching their own times by personal link or venue QR, with no login.
--
-- PURPOSE (Dan, 2026-09-04): the PM cannot see everyone on a multi-room or
-- staggered show, and the PM wants crew to carry responsibility for their own
-- punches.
--
-- WHY CREW PUNCHES ARE REAL PUNCHES
-- ---------------------------------
-- An earlier design had crew times land in a proposals table the PM accepted
-- row by row. That was dropped: four punches x fifty crew is two hundred
-- approvals, more work than batch punching, and the PM stays the author, so
-- responsibility never actually transfers.
--
-- It is also not the same case as booking_status (0012) or day_type (0015).
-- Those are SCHEDULING states, walled off from payroll because a scheduling
-- state must never quietly decide what somebody gets paid. A punch is not a
-- scheduling state. It is the same time data the PM already enters with no
-- verification whatsoever. The real question was never "is it payroll data"
-- but "is it attributable" — and that is answered with columns, below.
--
-- The sign-off is FINALIZE. Nothing becomes money until the Final Report is
-- sent, and that flow already blocks writes and warns about gaps.
--
-- BUILT TOWARD CREW LOGINS. Everything keys on crew_member_id, never on the
-- token, so when crew accounts arrive a real session resolves to the same rows
-- through the same write path.

-- 1. clock_links
-- --------------
-- Modelled on booking_invites (0014), which is the proven shape for a public
-- no-login token in this app: unguessable uuid, hard expiry, and a denormalized
-- organization_id so no policy ever has to reference shows.
--
-- ONE TABLE, TWO KINDS OF LINK, told apart by crew_member_id:
--   NULL     — the show's venue code. What the printed QR encodes. It carries
--              no identity; opening it asks you to pick a room and a name.
--   NOT NULL — one person's personal link. Bookmarkable, and the thing handed
--              out in bulk over Slack.
-- Keeping them in one table means one lookup, one expiry rule, one revoke path.
create table if not exists public.clock_links (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  -- NULL = the venue code for this show. See above.
  crew_member_id uuid references public.crew_members(id) on delete cascade,
  -- Denormalized and filled by the trigger below, exactly as booking_invites
  -- does. Every policy is then self-contained (organization_id =
  -- my_organization_id()) and never references shows. The RLS recursion
  -- incident showed Postgres's guard is structural and cannot be indirected
  -- away with a function, so the fix is to not need the reference at all.
  organization_id uuid not null references public.organizations(id),
  expires_at timestamptz not null,
  -- Revoked, not deleted: a leaked link must die without destroying the
  -- evidence of which punches came through it (punches.source_link).
  revoked_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists clock_links_show_id_idx on public.clock_links (show_id);
create index if not exists clock_links_crew_member_idx on public.clock_links (crew_member_id);

-- Partial unique indexes rather than one table constraint, because NULLs are
-- distinct to a unique constraint and would let a show collect any number of
-- venue codes. Same shape as timecards_one_live_fill_per_position.
create unique index if not exists clock_links_venue_uniq
  on public.clock_links (show_id) where crew_member_id is null;
create unique index if not exists clock_links_person_uniq
  on public.clock_links (show_id, crew_member_id) where crew_member_id is not null;

create or replace function public.set_clock_link_organization_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select s.organization_id into new.organization_id
  from shows s where s.id = new.show_id;
  return new;
end;
$$;

create trigger set_clock_link_org
  before insert on public.clock_links
  for each row execute function public.set_clock_link_organization_id();

alter table public.clock_links enable row level security;

-- All four policies in the same migration as the table. rls_auto_enable
-- force-enables RLS on every new table, so a table with no policies is one
-- nobody can read — a silent, total failure.
--
-- The public /clock page does NOT read through these: it uses the service role,
-- with the unguessable token as the authorization. These govern the staff side
-- only — who may mint, list and revoke links.
create policy "Members see clock links in their org"
  on public.clock_links for select
  using (organization_id = my_organization_id());

create policy "Timecard editors create clock links"
  on public.clock_links for insert
  with check (organization_id = my_organization_id() and my_perm('can_edit_timecards'));

create policy "Timecard editors update clock links"
  on public.clock_links for update
  using (organization_id = my_organization_id() and my_perm('can_edit_timecards'));

create policy "Timecard editors delete clock links"
  on public.clock_links for delete
  using (organization_id = my_organization_id() and my_perm('can_edit_timecards'));

grant select, insert, update, delete on public.clock_links to authenticated;

-- 2. punches attribution
-- ----------------------
-- punches has had NO audit trail of any kind: no created_by, no history. A
-- PM-entered time and any other time are indistinguishable after the fact,
-- which is precisely the distinction a payroll dispute turns on. Worth adding
-- on its own merits; adding a second write path into this table makes it
-- necessary.
--
-- The 'staff' default makes every one of the existing rows correct with no
-- backfill, because until this migration every punch was staff-entered.
alter table public.punches
  add column if not exists source text not null default 'staff';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'punches_source_check'
  ) then
    alter table public.punches
      add constraint punches_source_check check (source in ('staff', 'crew'));
  end if;
end
$$;

alter table public.punches
  add column if not exists created_by uuid references public.profiles(id);

-- Which link this came through, for forensics. ON DELETE SET NULL: deleting a
-- link must never take a recorded time with it.
alter table public.punches
  add column if not exists source_link uuid references public.clock_links(id) on delete set null;

comment on column public.punches.source is
  'Who authored this punch: staff (a signed-in PM) or crew (a no-login clock link). lib/payroll.ts must never read this — it is attribution, not a pay input.';
comment on column public.punches.created_by is
  'The signed-in profile that wrote this punch. NULL for crew-entered punches, which have no session.';

-- No column-level grants here: authenticated holds table-level SELECT/INSERT/
-- UPDATE/DELETE on punches (see grants.sql), so new columns inherit. This is
-- unlike organizations/memberships in 0017, which are column-locked.
