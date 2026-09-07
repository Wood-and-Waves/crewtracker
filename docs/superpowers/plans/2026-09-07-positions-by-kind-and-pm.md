# Positions by kind, the PM invitation, the two finish buttons (piece B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Section B of `docs/superpowers/specs/2026-09-07-show-flow-design.md` — a position is "a role, for these kinds of day" whose per-day slots are derived from the day grid and re-derived when it changes (adding open slots freely, never removing a booked person); filling a position gives the person its days with a checklist; the PM is named on New Show or Edit Show and gets access only by accepting an emailed invitation; New Show finishes with "Create show" or "Create show and send to scheduler".

**Architecture:** One migration (0034) adds `position_defs` (the definition), links `crew_call_positions` rows (the per-day slots the scheduler already fills) to it, and owns the derivation in one SQL function `sync_position_slots(show_id)` plus a `position_slot_flags` view for filled slots that no longer fit. A TypeScript twin (`lib/positionDefs.ts`) previews the same derivation on New Show before the show exists and is unit-tested against the 8-day example. The PM invitation mirrors booking invites: a `pm_invites` row with a token, an email with **Accept**, a public `/pm/[token]` page posting to `/api/pm/accept`, which writes the `show_assignments` row that grants access. Everything else the spec deferred (queue, ready email, digest) is piece C.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres 17, plpgsql, RLS), Resend, TypeScript, the repo's plain-Node tests.

## Global Constraints

- **The app adds open slots freely and never removes a booked person.** `sync_position_slots` deletes only UNFILLED slots; a filled slot whose day no longer fits becomes a flag for a human.
- **Naming a PM sends an invitation after one confirmation; accepting it is the ONLY thing that grants access.** No silent accept (Dan, 2026-09-07).
- **Access is written as a `show_assignments` row with `source = 'pm'`**; changing the PM removes only rows with that source, never one an admin granted by hand.
- Every browser write verified; every public route POST-only, allowlisted in `proxy.ts`, and rate-limited (`lib/rateLimit.ts`); every emailed link from `siteOrigin()`.
- New policies wrapped `(select fn())`; no table's policy may reference a table whose policy references it back.
- `crew_call_positions` rows with no `position_def_id` (every row that exists today, and anything `CrewCallModal` creates) keep working exactly as now.
- Migrations dev-first → tests → production on Dan's word (backup → `--prod` → `db:grants` → `db:schema` → merge). Blast radius in the same sentence as any commit/push. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Plain-English copy, sentence case, "position" never "call". Desktop first for New Show.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/sql/migrations/0034_position_defs_and_pm.sql` | `position_defs`, `crew_call_positions.position_def_id`, `sync_position_slots()`, `position_slot_flags`, `shows.pm_*`, `pm_invites`, `show_assignments.source`, policies, grants |
| `scripts/test/rls.mts` | the SQL derivation on the 8-day example (add a day, retag, remove; filled never vanish; flags), defs/invites visibility and writes |
| `lib/positionDefs.ts` (new, plain) | `DayKind`, `PositionDef`, `wantedRoomDays()`, `planSlotSync()` — the TS twin of the SQL, for New Show's preview and tests |
| `scripts/test/schedule.mts` | the twin's cases |
| `components/PositionDefsEditor.tsx` (new) | per-room list of (role, count, kind, custom dates); controlled (New Show) or self-saving (Edit Show) |
| `components/CrewCallGrid.tsx` | cells become a read-only preview of derived counts when `derivedCounts` is passed |
| `components/NewShowClient.tsx` | defs in state; inserts defs; calls `sync_position_slots`; PM field; two finish buttons |
| `components/EditShowClient.tsx` | Positions section (self-saving defs), flags list, PM field with state and Resend, `?handoff=1` opens the handoff |
| `components/AddDayButton.tsx`, the day toggle in `EditShowClient` | call `sync_position_slots` after their write |
| `components/FillPositionPicker.tsx` | the day checklist for a definition's other open slots |
| `components/PmField.tsx` (new) | the Production manager picker + "Invite Sam as PM?" confirmation |
| `lib/pmInviteEmail.ts` (new), `app/api/pm/invite/route.ts` (new), `app/api/pm/accept/route.ts` (new), `app/pm/[token]/page.tsx` + `AcceptPmForm.tsx` (new) | the invitation |
| `proxy.ts` | allowlist `/pm`, `/api/pm/accept` |
| `CLAUDE.md` | the model; migrations; new files |

---

### Task 1: Migration 0034 and the SQL derivation, proven on the 8-day example

**Files:**
- Create: `scripts/sql/migrations/0034_position_defs_and_pm.sql`
- Modify: `scripts/test/rls.mts`

**Interfaces (Produces):**
- `position_defs(id, show_id, room_name, role, count, day_kind, custom_dates, sort_order, created_by, created_at)`; `crew_call_positions.position_def_id`; `sync_position_slots(p_show_id uuid) returns void`; view `position_slot_flags(slot_id, show_id, position_def_id, room_name, date, role, timecard_id, crew_member_name)`; `shows.pm_profile_id / pm_invited_at / pm_accepted_at`; `pm_invites(id, token, show_id, profile_id, organization_id, sent_by, sent_at, accepted_at)`; `show_assignments.source`.

- [ ] **Step 1: Failing checks.** In `rls.mts`, fixtures after the 0032 block's cleanup (owner connection). Build the 8-day run on a fresh show in org A:

```ts
  console.log('\n=== positions by kind: slots derived from the day grid (0034) ===')
  {
    const [sh] = await q(`insert into shows (organization_id, name, start_date, end_date) values ($1,'Eight Day','2026-11-02','2026-11-09') returning id`, [orgA])
    const acts = [['travel'],['load_in'],['load_in','rehearsal'],['rehearsal','show'],['show'],['show'],['show','load_out'],['load_out','travel']]
    const dayIds: string[] = []
    for (let i = 0; i < 8; i++) {
      const [d] = await q(`insert into work_days (show_id, date, day_number, activities) values ($1, ('2026-11-02'::date + $2)::date, $3, $4) returning id`, [sh.id, i, i + 1, acts[i]])
      dayIds.push(d.id)
      await q(`insert into rooms (work_day_id, name) values ($1,'Ballroom')`, [d.id])
    }
    const [dAll] = await q(`insert into position_defs (show_id, room_name, role, count, day_kind) values ($1,'Ballroom','A1',1,'all') returning id`, [sh.id])
    const [dShow] = await q(`insert into position_defs (show_id, room_name, role, count, day_kind) values ($1,'Ballroom','Camera Op',2,'show') returning id`, [sh.id])
    const [dLoad] = await q(`insert into position_defs (show_id, room_name, role, count, day_kind) values ($1,'Ballroom','Stagehand',3,'load') returning id`, [sh.id])
    await q(`select sync_position_slots($1)`, [sh.id])
    const count = async (def: string) => (await q(`select count(*)::int n from crew_call_positions where position_def_id=$1`, [def]))[0].n
    check('all days: one slot per day', await count(dAll.id), 8)
    check('show days: 2 × the 4 show days', await count(dShow.id), 8)
    check('load days: 3 × the 4 load days (in: Tue,Wed · out: Sun,Mon)', await count(dLoad.id), 12)
    check('sync is idempotent', (await q(`select sync_position_slots($1)`, [sh.id]), await count(dLoad.id)), 12)

    // Book a stagehand on Sunday (day 7, show+load_out), then retag Sunday to plain show.
    const [sunRoom] = await q(`select id from rooms where work_day_id=$1`, [dayIds[6]])
    const [slot] = await q(`select id from crew_call_positions where position_def_id=$1 and room_id=$2 limit 1`, [dLoad.id, sunRoom.id])
    const [cmA] = await q(`select id from crew_members where organization_id=$1 and full_name='A Crew'`, [orgA])
    await q(`insert into timecards (room_id, crew_member_id, crew_member_name, role, call_position_id, booking_status) values ($1,$2,'A Crew','Stagehand',$3,'confirmed')`, [sunRoom.id, cmA.id, slot.id])
    await q(`update work_days set activities='{show}' where id=$1`, [dayIds[6]])
    await q(`select sync_position_slots($1)`, [sh.id])
    const sunSlots = await q(`select id from crew_call_positions where position_def_id=$1 and room_id=$2`, [dLoad.id, sunRoom.id])
    check('retagging removes the UNFILLED Sunday stagehand slots', sunSlots.length === 1 && sunSlots[0].id === slot.id, `${sunSlots.length} left`)
    const flags = await q(`select role, crew_member_name from position_slot_flags where show_id=$1`, [sh.id])
    check('and the booked one becomes a flag for a human', flags.length === 1 && flags[0].crew_member_name === 'A Crew', JSON.stringify(flags))

    // Add a ninth day as load_out: open stagehand slots appear, nobody is added.
    const [d9] = await q(`insert into work_days (show_id, date, day_number, activities) values ($1,'2026-11-10',9,'{load_out}') returning id`, [sh.id])
    await q(`insert into rooms (work_day_id, name) values ($1,'Ballroom')`, [d9.id])
    await q(`select sync_position_slots($1)`, [sh.id])
    const [r9] = await q(`select id from rooms where work_day_id=$1`, [d9.id])
    check('a new load-out day grows 3 open stagehand slots', (await q(`select count(*)::int n from crew_call_positions where position_def_id=$1 and room_id=$2`, [dLoad.id, r9.id]))[0].n, 3)
    check('and 1 open A1 slot', (await q(`select count(*)::int n from crew_call_positions where position_def_id=$1 and room_id=$2`, [dAll.id, r9.id]))[0].n, 1)
    check('nobody was booked by the app', (await q(`select count(*)::int n from timecards t join rooms r on r.id=t.room_id where r.work_day_id=$1`, [d9.id]))[0].n, 0)

    // Lowering a count deletes unfilled extras only.
    await q(`update position_defs set count=1 where id=$1`, [dLoad.id])
    await q(`select sync_position_slots($1)`, [sh.id])
    check('count 3 → 1 keeps one slot per load day (the booked Sunday one is a flag, not a slot of a wanted day)', await count(dLoad.id), 5 + 1)

    // Custom dates ignore the grid.
    const [dCus] = await q(`insert into position_defs (show_id, room_name, role, count, day_kind, custom_dates) values ($1,'Ballroom','Runner',1,'custom','{2026-11-04,2026-11-05}') returning id`, [sh.id])
    await q(`select sync_position_slots($1)`, [sh.id])
    check('custom dates: exactly those days', await count(dCus.id), 2)

    await q(`delete from shows where id=$1`, [sh.id])
  }
```

`check` in `rls.mts` is `check(name, cond, detail)` — the calls above pass a boolean where they compare; adjust the three that pass a number: `check('…', (await count(x)) === 8, …)`. Run `npm run test:rls` → fails on `position_defs` missing.

- [ ] **Step 2: The migration**

```sql
-- Piece B of the 2026-09-07 show-flow spec.
--
-- A POSITION IS "A ROLE, FOR THESE KINDS OF DAY". Sales says "2 stagehands in
-- the Ballroom for load-in and load-out"; the app works out the days from the
-- day grid (work_days.activities, 0032). The per-day slots the scheduler fills
-- stay what they are — crew_call_positions rows — and gain a parent that says
-- WHY they exist, so they can follow the day grid when it changes.
--
-- THE ONE RULE: the app adds open slots freely and NEVER removes a booked
-- person. sync_position_slots() deletes only unfilled slots; a filled slot
-- whose day no longer fits its definition is a FLAG (position_slot_flags) for
-- a human to move / keep / release.
--
-- THE PM IS INVITED, AND ACCEPTING IS WHAT GRANTS ACCESS. shows.pm_profile_id
-- names them; a pm_invites row carries the token; accepting writes the
-- show_assignments row (source='pm'). Nothing else counts. Dan: a silent
-- accept is dangerous.
--
-- Legacy rows (position_def_id null) — every slot that exists today and
-- anything CrewCallModal creates — are untouched by the sync.

-- 1. Definitions.
create table if not exists public.position_defs (
  id            uuid primary key default gen_random_uuid(),
  show_id       uuid not null references public.shows(id) on delete cascade,
  room_name     text not null,
  role          text not null,
  count         integer not null default 1 check (count between 1 and 99),
  day_kind      text not null default 'all' check (day_kind in ('all','show','load','custom')),
  custom_dates  date[] null,
  sort_order    integer not null default 0,
  created_by    uuid null references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists position_defs_show_idx on public.position_defs (show_id);
alter table public.position_defs enable row level security;
alter table public.position_defs force row level security;
-- Same scope as crew_call_positions: anyone who can see the show.
create policy "Users see position defs for their shows" on public.position_defs
  for select using (show_id in (select id from shows));
create policy "Users manage position defs for their shows" on public.position_defs
  for all using (show_id in (select id from shows)) with check (show_id in (select id from shows));
grant select, insert, update, delete on public.position_defs to authenticated;

alter table public.crew_call_positions
  add column if not exists position_def_id uuid null references public.position_defs(id) on delete set null;
create index if not exists crew_call_positions_def_idx on public.crew_call_positions (position_def_id);

-- 2. Which room-days a definition wants. `load` = load_in OR load_out.
create or replace function public.position_def_wants(p_def public.position_defs, p_activities text[], p_date date)
returns boolean language sql immutable as $$
  select case p_def.day_kind
    when 'all'    then true
    when 'show'   then 'show' = any(p_activities)
    when 'load'   then p_activities && array['load_in','load_out']
    when 'custom' then p_date = any(coalesce(p_def.custom_dates, '{}'))
    else false end;
$$;

-- 3. The derivation. SECURITY INVOKER on purpose: it runs as the caller, so
--    the crew_call_positions policies decide what they may touch.
create or replace function public.sync_position_slots(p_show_id uuid) returns void
language plpgsql as $$
declare
  d public.position_defs%rowtype;
  r record;
  have integer;
begin
  for d in select * from position_defs where show_id = p_show_id loop
    -- Wanted room-days: top up to count.
    for r in
      select rm.id as room_id
      from rooms rm join work_days wd on wd.id = rm.work_day_id
      where wd.show_id = p_show_id and rm.name = d.room_name
        and position_def_wants(d, wd.activities, wd.date)
    loop
      select count(*) into have from crew_call_positions where position_def_id = d.id and room_id = r.room_id;
      if have < d.count then
        insert into crew_call_positions (room_id, role, sort_order, position_def_id, created_by)
        select r.room_id, d.role, d.sort_order, d.id, auth.uid() from generate_series(1, d.count - have);
      elsif have > d.count then
        -- Too many: drop UNFILLED extras only.
        delete from crew_call_positions p
        where p.id in (
          select p2.id from crew_call_positions p2
          where p2.position_def_id = d.id and p2.room_id = r.room_id
            and not exists (select 1 from timecards t where t.call_position_id = p2.id and t.booking_status is distinct from 'declined')
          order by p2.created_at desc limit (have - d.count));
      end if;
    end loop;
    -- Unwanted room-days: drop UNFILLED slots. Filled ones stay and show as flags.
    delete from crew_call_positions p
    where p.position_def_id = d.id
      and not exists (select 1 from timecards t where t.call_position_id = p.id and t.booking_status is distinct from 'declined')
      and not exists (
        select 1 from rooms rm join work_days wd on wd.id = rm.work_day_id
        where rm.id = p.room_id and rm.name = d.room_name and position_def_wants(d, wd.activities, wd.date));
  end loop;
end; $$;
revoke execute on function public.sync_position_slots(uuid) from public, anon;
grant execute on function public.sync_position_slots(uuid) to authenticated, service_role;

-- 4. Filled slots whose day no longer fits their definition.
create or replace view public.position_slot_flags with (security_invoker = true) as
  select p.id as slot_id, wd.show_id, p.position_def_id, rm.name as room_name, wd.date, p.role,
         t.id as timecard_id, t.crew_member_name
  from crew_call_positions p
  join position_defs d on d.id = p.position_def_id
  join rooms rm on rm.id = p.room_id
  join work_days wd on wd.id = rm.work_day_id
  join timecards t on t.call_position_id = p.id and t.booking_status is distinct from 'declined'
  where not (rm.name = d.room_name and position_def_wants(d, wd.activities, wd.date));
grant select on public.position_slot_flags to authenticated;

-- 5. The PM.
alter table public.shows
  add column if not exists pm_profile_id uuid null references public.profiles(id) on delete set null,
  add column if not exists pm_invited_at timestamptz null,
  add column if not exists pm_accepted_at timestamptz null;

create table if not exists public.pm_invites (
  id              uuid primary key default gen_random_uuid(),
  token           uuid not null unique default gen_random_uuid(),
  show_id         uuid not null references public.shows(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sent_by         uuid null references public.profiles(id),
  sent_at         timestamptz not null default now(),
  accepted_at     timestamptz null
);
create index if not exists pm_invites_show_idx on public.pm_invites (show_id);
alter table public.pm_invites enable row level security;
alter table public.pm_invites force row level security;
-- Readable/creatable by anyone who can see the show (the token is what the
-- invitee uses, via the service role; nobody reads it from a browser).
create policy "Users see pm invites for their shows" on public.pm_invites
  for select using (organization_id = (select my_organization_id()) and show_id in (select id from shows));
create policy "Users create pm invites for their shows" on public.pm_invites
  for insert with check (organization_id = (select my_organization_id()) and show_id in (select id from shows));
create policy "Users delete pm invites for their shows" on public.pm_invites
  for delete using (organization_id = (select my_organization_id()) and show_id in (select id from shows));
grant select, insert, delete on public.pm_invites to authenticated;

alter table public.show_assignments
  add column if not exists source text not null default 'manual' check (source in ('manual','pm'));
```

Then check whether `shows` is column-granted: `grep -n '"public"."shows"' scripts/sql/grants.sql`. If UPDATE is column-level, append `grant update (pm_profile_id, pm_invited_at) on public.shows to authenticated;` (accepting sets `pm_accepted_at` through the service role). If table-level, nothing.

- [ ] **Step 3: Apply and test** — `npm run db:migrate`; `npm run test:rls` → every new check ✓ (expect 12 new; `104 passed`). If `position_def_wants` complains about the composite parameter from within the view, replace `p_def public.position_defs` with the three scalar parameters `(p_kind text, p_custom date[], p_activities text[], p_date date)` and adjust the three call sites.

- [ ] **Step 4: Commit** — `scheduling`; dev migrated; production untouched

```bash
git add scripts/sql/migrations/0034_position_defs_and_pm.sql scripts/test/rls.mts
git commit -m "Migration 0034: positions by kind of day (definitions, derived slots, flags) and the PM invitation tables.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 2: `lib/positionDefs.ts` — the TypeScript twin, tested

**Files:**
- Create: `lib/positionDefs.ts`
- Modify: `scripts/test/schedule.mts`

**Interfaces (Produces):**
```ts
export type DayKind = 'all' | 'show' | 'load' | 'custom'          // re-export from dayActivities
export const DAY_KIND_LABELS: Record<DayKind, string>            // 'All days' | 'Show days' | 'Load-in and load-out' | 'Custom dates'
export type PositionDef = { key: string; roomKey: string; role: string; count: number; dayKind: DayKind; customDates: string[] }
export type GridDay = { date: string; activities: string[] }
export function defWants(def: Pick<PositionDef,'dayKind'|'customDates'>, day: GridDay): boolean
export function derivedCounts(defs: PositionDef[], days: GridDay[], roomsOnDay: (roomKey: string, dayIndex: number) => boolean): Record<string, Record<number, number>>   // roomKey → dayIndex → slots
export function describeDefDays(def: PositionDef, days: GridDay[]): string          // "Tue 3, Wed 4, Sun 8, Mon 9" or "every day"
```

- [ ] **Step 1: Tests** — append to `schedule.mts`:

```ts
import { defWants, derivedCounts, describeDefDays, type PositionDef, type GridDay } from '../../lib/positionDefs.ts'
console.log('\n=== positions by kind: the preview matches the SQL (0034) ===')
const eight: GridDay[] = [
  ['travel'],['load_in'],['load_in','rehearsal'],['rehearsal','show'],['show'],['show'],['show','load_out'],['load_out','travel'],
].map((activities, i) => ({ date: `2026-11-0${2 + i}`.replace('2026-11-010', '2026-11-10'), activities }))
const def = (o: Partial<PositionDef>): PositionDef => ({ key: 'k', roomKey: 'ball', role: 'A1', count: 1, dayKind: 'all', customDates: [], ...o })
const always = () => true
check('all days wants every day', eight.every(d => defWants(def({}), d)), true)
check('show days wants the four show days', eight.filter(d => defWants(def({ dayKind: 'show' }), d)).length, 4)
check('load wants load-in OR load-out days', eight.filter(d => defWants(def({ dayKind: 'load' }), d)).length, 4)
check('custom wants exactly its dates', eight.filter(d => defWants(def({ dayKind: 'custom', customDates: ['2026-11-04'] }), d)).length, 1)
const counts = derivedCounts([def({ key: 'a' }), def({ key: 'b', role: 'Stagehand', count: 3, dayKind: 'load' })], eight, always)
check('derived counts per day add up (1 A1 + 3 stagehands on a load day)', counts.ball[1], 4)
check('and on a plain show day only the A1', counts.ball[4], 1)
check('a room that does not run that day gets nothing', derivedCounts([def({})], eight, (_, i) => i !== 0).ball[0] ?? 0, 0)
check('describeDefDays reads as dates', describeDefDays(def({ dayKind: 'load' }), eight), 'Tue 3, Wed 4, Sun 8, Mon 9')
check('describeDefDays for all days', describeDefDays(def({}), eight), 'every day')
```

(The `eight` dates: fix the helper so days 1–8 are 2026-11-02…2026-11-09 — write them out literally rather than with string tricks.)

- [ ] **Step 2: The module**

```ts
// Positions "by kind of day" — the browser-side twin of sync_position_slots()
// in migration 0034, so New Show can preview slot counts before the show
// exists, and so the rule is unit-tested. The DATABASE derivation is the
// truth; keep the two in step.
import { isKindOfDay, type DayKind } from '@/lib/dayActivities'
export type { DayKind }

export const DAY_KIND_LABELS: Record<DayKind, string> = {
  all: 'All days', show: 'Show days', load: 'Load-in and load-out', custom: 'Custom dates',
}

export type PositionDef = {
  key: string
  roomKey: string
  role: string
  count: number
  dayKind: DayKind
  customDates: string[]
}
export type GridDay = { date: string; activities: string[] }

export function defWants(def: Pick<PositionDef, 'dayKind' | 'customDates'>, day: GridDay): boolean {
  if (def.dayKind === 'custom') return def.customDates.includes(day.date)
  return isKindOfDay(day.activities, def.dayKind)
}

/** roomKey → dayIndex → number of slots, for the grid's read-only cells. */
export function derivedCounts(
  defs: PositionDef[], days: GridDay[], roomsOnDay: (roomKey: string, dayIndex: number) => boolean,
): Record<string, Record<number, number>> {
  const out: Record<string, Record<number, number>> = {}
  for (const d of defs) {
    days.forEach((day, i) => {
      if (!roomsOnDay(d.roomKey, i) || !defWants(d, day)) return
      out[d.roomKey] ??= {}
      out[d.roomKey][i] = (out[d.roomKey][i] ?? 0) + d.count
    })
  }
  return out
}

export function describeDefDays(def: PositionDef, days: GridDay[]): string {
  if (def.dayKind === 'all') return 'every day'
  const hit = days.filter(d => defWants(def, d))
  if (!hit.length) return 'no days yet'
  return hit.map(d => new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })).join(', ')
}
```

- [ ] **Step 3: Run** `npm run test:schedule` → green; commit:

```bash
git add lib/positionDefs.ts scripts/test/schedule.mts
git commit -m "positionDefs: the browser twin of the slot derivation, tested on the 8-day run.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 3: Positions by kind on New Show and Edit Show; the grid previews; sync after day changes

**Files:**
- Create: `components/PositionDefsEditor.tsx`
- Modify: `components/CrewCallGrid.tsx`, `components/NewShowClient.tsx`, `components/EditShowClient.tsx`, `app/dashboard/shows/[id]/edit/page.tsx`, `components/AddDayButton.tsx`

- [ ] **Step 1: `PositionDefsEditor`.** Props: `rooms: { key: string; name: string }[]`, `roles: string[]`, `days: GridDay[]`, `defs: PositionDef[]`, `onChange(next: PositionDef[])`, `readOnly?`. Renders one ruled block per room: its definitions as rows — role (`Select` from `roles`), count (number 1–99), kind (`Select` of `DAY_KIND_LABELS`), and for `custom` a row of date chips (one per show day, tap to include) — with the derived day list under each row ("Tue 3, Wed 4, Sun 8, Mon 9") from `describeDefDays`, a ✕ to remove, and "+ Add position" per room. Pure controlled component; no writes. Keys are `crypto.randomUUID()` on add.

- [ ] **Step 2: `CrewCallGrid` previews.** New optional prop `derivedCounts?: Record<string, Record<number, number>>`. When present: cells render the number (or "—"), are not clickable, the cell editor and "+ Add positions" are hidden, and the header note reads the peak from these counts. Everything else (rooms, room-day toggles) unchanged. The prop's absence keeps today's behaviour for any other caller.

- [ ] **Step 3: New Show.** State `defs: PositionDef[]`; render `PositionDefsEditor` under the grid inside section 4 with `days = dates.map(date => ({ date, activities: activities[date] ?? [] }))`; pass `derivedCounts={derivedCounts(defs, days, (roomKey, i) => roomDayIndices(call, roomKey, totalDays).includes(i))}` to the grid (the `call` model keeps only room-day existence now — cells are no longer edited). On create, after rooms exist: insert `position_defs` rows `{ show_id, room_name, role, count, day_kind, custom_dates, sort_order }` from `defs` (room name via `nameByKey`), then `await supabase.rpc('sync_position_slots', { p_show_id: showId })`; the old `plannedPositions` insert goes. Keep the "show created but positions didn't save" error shape.

- [ ] **Step 4: Edit Show.** The page selects `position_defs` for the show and `position_slot_flags`; `EditShowClient` gets a **Positions** section (below Day activities): `PositionDefsEditor` in self-saving mode — a wrapper that diffs `onChange` against the last saved list and writes insert/update/delete on `position_defs` (verified), then `rpc('sync_position_slots')`, then `router.refresh()`. Deleting a definition: first `delete from crew_call_positions where position_def_id = … and no live timecard` via the same path the sync uses (call sync AFTER deleting the def — the FK sets `position_def_id` null on remaining filled slots, which then keep working as legacy one-offs; say so in a comment). Under Day activities, a **flags** rule when `position_slot_flags` has rows: "3 bookings no longer match their days" with each line "Sam Lindqvist · Stagehand · Sun, Nov 8" and three buttons — **Move** (opens a `Select` of that definition's open slots on other days; updates `timecards.room_id` + `call_position_id`), **Keep** (sets the slot's `position_def_id` to null — a custom one-off from now on), **Release** (deletes the timecard, then the slot; confirm first). The day toggle's success path calls `rpc('sync_position_slots')` before `router.refresh()`.

- [ ] **Step 5: Add Day.** In `AddDayButton.tsx`, after `add_show_day` succeeds, `await supabase.rpc('sync_position_slots', { p_show_id: showId })` (the button already knows `showId`; check its props) — new open slots appear on the new day for every definition that wants it. The "extend all-day people" checkbox is piece C.

- [ ] **Step 6: Prove on dev** (browser, Playwright signed in, 1440 wide): New Show with the 8-day run from the test → section 4 shows the grid with derived numbers; add "Stagehand ×3, load-in and load-out" and "A1 ×1, all days" to the Ballroom → cells read 4 on load days, 1 on show days; create → on dev `select count(*) from crew_call_positions where position_def_id is not null` = 20; Edit Show → Positions lists both; change stagehands to 1 → count drops to 5 unfilled removed (SQL shows 8 + 4 + … verify); toggle Sunday to plain Show → the stagehand slots on Sunday vanish (unfilled). Book one via the tracker's Fill position on a load day (Task 4 will change that dialog; use it as is), retag that day → the flag line appears with Move/Keep/Release; Release it. Delete the show.

- [ ] **Step 7: Build, commit**

```bash
npm run build && rm -rf .next
git add components/PositionDefsEditor.tsx components/CrewCallGrid.tsx components/NewShowClient.tsx components/EditShowClient.tsx app/dashboard/shows/[id]/edit/page.tsx components/AddDayButton.tsx
git commit -m "Positions by kind of day on New Show and Edit Show; slots re-derived after day changes; flags for booked people whose day no longer fits.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 4: Filling a position gives the person its days, with a checklist

**Files:**
- Modify: `components/FillPositionPicker.tsx` (+ its callers pass `positionDefId`, `showId`)

- [ ] **Step 1:** When `positionDefId` is set, after the person is chosen the picker shows a second step: "Sam's days" — the definition's OPEN slots on other days (`crew_call_positions` where `position_def_id = … and no live timecard`, joined to rooms→work_days for the date), each ticked by default, with the clicked slot always included. Confirm → **one multi-row insert** of timecards (room_id, crew_member_id, name, role, call_position_id, `booking_status: 'pencilled'`) for every ticked slot; a `23505` on any row means somebody filled one meanwhile — report which day and refresh. Without `positionDefId` (legacy slots), behaviour is exactly today's.

- [ ] **Step 2: Prove on dev:** on the throwaway 8-day show, Fill an A1 slot → the checklist lists the other 7 A1 days ticked → confirm → 8 timecards pencilled, 8 slots filled (SQL). Untick two on a second person for a different definition → 6 timecards, 2 slots still open.

- [ ] **Step 3: Build, commit**

```bash
git add components/FillPositionPicker.tsx components/CrewCallModal.tsx components/OpenPositionRow.tsx
git commit -m "Fill position: the person gets the definition's days, with a checklist to trim.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 5: The PM invitation

**Files:**
- Create: `components/PmField.tsx`, `lib/pmInviteEmail.ts`, `app/api/pm/invite/route.ts`, `app/api/pm/accept/route.ts`, `app/pm/[token]/page.tsx`, `app/pm/[token]/AcceptPmForm.tsx`
- Modify: `proxy.ts`, `components/NewShowClient.tsx`, `components/EditShowClient.tsx`, `app/dashboard/shows/[id]/edit/page.tsx`, `app/dashboard/shows/new/page.tsx` (passes org members), `scripts/test/rls.mts`

- [ ] **Step 1: Failing RLS checks** (before the signed-out section): as the owner, insert a `pm_invites` row for `dave` on `showA2` and confirm dave does NOT see showA2's timecards through the PM door until a `show_assignments(source='pm')` row exists; after inserting it, he does; deleting rows `where source='pm'` leaves a `source='manual'` assignment (alice's hand-granted one for showA) untouched. Three checks.

- [ ] **Step 2: `lib/pmInviteEmail.ts`** — `buildPmInviteEmail({ pmName, showName, dates, venue, orgName, inviterName, acceptUrl })` → `{ subject, text, html }` in the booking email's voice ("Northwind User Conference · Sep 4–9 · Moscone West — you've been named production manager. Accept to get the show in your CrewTracker."), and `sendPmInviteEmail(input)` using the same Resend construction-per-call and `FROM` as `lib/bookingEmail.ts`.

- [ ] **Step 3: `POST /api/pm/invite`** (session): body `{ showId, profileId }`. Through the caller's client: `update shows set pm_profile_id, pm_invited_at = now(), pm_accepted_at = null where id = showId` verified (the shows UPDATE policy is the authorisation); delete `show_assignments where show_id and source = 'pm'` and `pm_invites where show_id` (via the caller's client — policies allow); insert a fresh `pm_invites` row; look up the invitee's email (`profiles`, visible in-org); send the email with `acceptUrl = ${siteOrigin()}/pm/${token}`. Returns `{ ok, sentTo }`. `resend: true` in the body re-sends the existing token.

- [ ] **Step 4: `/pm/[token]`** — public page (allowlist `/pm` and `/api/pm/accept` in `proxy.ts`): loads the invite via the service role with explicit columns (show name, dates, venue, org name, inviter, accepted_at); states: bad token / already accepted ("You're the PM on Northwind — open it") / the offer with one **Accept** button (`AcceptPmForm`, POST). `robots: noindex` like `/book`.

- [ ] **Step 5: `POST /api/pm/accept`** (public, POST-only, `rateLimitOr` per token 10/hour and per IP 30/hour): body `{ token }`; service role: find the invite (404 if none; if already accepted return ok); insert `show_assignments (show_id, profile_id, source='pm')` (organization_id filled by its trigger) unless one exists; set `pm_invites.accepted_at` and `shows.pm_accepted_at`; return `{ ok, showId }`. The form then sends the person to `/dashboard/shows/<id>` (login if needed).

- [ ] **Step 6: `PmField`** — a `Select` of the organization's members (`memberships` + `profiles`, the same list `ShowAccessEditor` gets), "Not assigned yet" as the empty option. On New Show: state only; the create path calls `/api/pm/invite` after the show exists if a PM was chosen (one confirm before creating: "Invite Sam as PM?" is folded into the finish button's confirm). On Edit Show: choosing a member opens the confirm "Invite Sam as PM? They'll get an email and the show once they accept." → `/api/pm/invite`; beside the field: *Invited Sep 7, waiting* / *Accepted Sep 8* / **Resend**. Changing the PM re-asks.

- [ ] **Step 7: Prove on dev.** Add a case to `scripts/test/preview-booking-message.mts`'s sibling — a new `scripts/test/preview-pm-invite.mts` (same shape) that prints `buildPmInviteEmail(...)` for the Northwind example, so the wording is read, not guessed. Then on dev: name the `crewtest@example.test` login (it exists from the crew-side work; give it the `pm` preset for this test, put it back after) as PM on the throwaway show → the route inserts the `pm_invites` row; read its token with SQL; open `/pm/<token>` in the pane → **Accept** → `select source from show_assignments where show_id=…` = `pm` and `pm_accepted_at` set; sign the pane in as crewtest via the dev login → the show is in their list and opens on the tracker (PM-side). Change the PM to someone else → the old `source='pm'` assignment row is gone and the show leaves crewtest's list. No email actually needs to reach a mailbox for any of this — Resend is called; if the key is missing on dev the route reports `{ error }` and the rest still holds.

- [ ] **Step 8: Build, commit**

```bash
git add components/PmField.tsx lib/pmInviteEmail.ts app/api/pm/invite/route.ts app/api/pm/accept/route.ts app/pm proxy.ts components/NewShowClient.tsx components/EditShowClient.tsx app/dashboard/shows/[id]/edit/page.tsx app/dashboard/shows/new/page.tsx scripts/test/rls.mts
git commit -m "The PM is invited by email and gets the show by accepting; nothing else grants it (Section B).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 6: Two finish buttons, docs, STOP for Dan

**Files:**
- Modify: `components/NewShowClient.tsx`, `components/EditShowClient.tsx`, `CLAUDE.md`

- [ ] **Step 1:** New Show's footer gets two buttons: **Create show** (as now) and **Create show and send to scheduler** (`Button variant="ghost"`; disabled with a title when there are no positions, the same rule the handoff route enforces). The second runs the same create path and then `router.push(\`/dashboard/shows/${showId}/edit?handoff=1\`)`; `EditShowClient` reads `?handoff=1` (`useSearchParams`) and opens `HandoffToSchedulerButton`'s dialog on mount — today's handoff (pick a scheduler) until piece C replaces it with the queue.

- [ ] **Step 2: CLAUDE.md** — under the day-activities section add **"Positions by kind and the PM invitation (piece B)"**: the definition/slot split and the one rule (add freely, never remove a person; flags); `sync_position_slots` runs after defs change, day toggles, Add Day; legacy slots untouched; Fill's checklist; the PM door (invite → accept → `show_assignments.source='pm'`; nothing else); `/pm/[token]` public and rate-limited; `?handoff=1`. Migrations list (0034 dev-only until cutover), schema section, file map, test count.

- [ ] **Step 3: Commit docs, push, and report to Dan** — preview URL and what to try (New Show with the 8-day run: positions by kind, name a PM, "Create show and send to scheduler"; Edit Show: Positions, flags after retagging a day, PM state; a Fill with the checklist), the cutover steps (backup → 0034 `--prod` → `db:grants` → `db:schema` → merge; 0034 writes no existing rows), and send the push notification.
