# Scheduling queue, ready email, digest, flags, crew change notices (piece C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A show is sent to *everyone* with the scheduling permission rather than to one named scheduler; schedulers see only sent shows and get a "Needs scheduling" list; the accepted PM gets a ready email when the last position is confirmed and an evening digest after that; Add Day extends all-day people; anyone who changes a booked person's days is offered a crew notice.

**Architecture:** One migration (0035) adds `shows.sent_to_scheduling_at` / `ready_email_sent_at`, the `staffing_events` table, a plpgsql `extend_all_day_positions()`, and swaps the `scheduler_id = auth.uid()` arm for `my_perm('can_manage_scheduling') and sent_to_scheduling_at is not null` in every place that arm lives (the shows policy, `my_pm_show_ids()`, the 0030 timecards/punches policies, `timecard_day_rates`). Emails are plain modules with a `build…` (pure, tested, previewed) and a `send…` (Resend per call). The ready email is ONE function, `maybeSendReadyEmail(admin, showId)`, called from the two routes that can complete a show. The digest is a daily Vercel cron reading `staffing_events` rows with `sent_at is null`. Crew change notices are a small in-place bar the three "days changed" surfaces render after their write.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Resend, Vercel Cron, the repo's plain-Node test scripts.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-07-show-flow-design.md`, section C. Decisions table is binding.
- **"Everyone with the scheduling permission"** = live `memberships` rows with `can_manage_scheduling = true` in the show's organization. Nobody owns a show.
- **Schedulers see only sent shows.** `shows.scheduler_id` stops being written; it stays for history and NOTHING reads it after this plan. `call_approved_at` / `call_approved_by` also stop being written; `sent_to_scheduling_at` is backfilled from `call_approved_at` so shows handed off before this keep their state.
- **The ready email goes only to a PM who has accepted** (`pm_accepted_at` set) and only once (`ready_email_sent_at`). "Ready" = the show has no open slot AND no live booking whose `booking_status` is `pencilled` or `invited`.
- **The digest goes only after the ready email**, and never for a finalized or archived show.
- **Crew change notices are offered, never automatic.**
- **No money in any email.** No rate, no total. Phones are allowed in the ready email (the PM needs them) and nowhere else.
- Every policy term calls helpers as `(select fn())`; every RLS change is pinned in `scripts/test/rls.mts`; `db:sql` bypasses RLS and proves nothing.
- Emails: Resend constructed per call, never at module scope; links from `siteOrigin()`, never the Host header. Every `build…` function has a preview in `scripts/test/preview-show-emails.mts` so the wording is read, not guessed.
- Writes are VERIFIED (`.select('id')` + row count) on the caller's session; service role only after the caller's write has proven their authority, or in public/cron routes.
- Every user-facing string says **positions**, never "call".
- Migration goes dev → tests → Dan tries the preview → backup → `--prod` → `db:grants` → `db:schema` → merge, on Dan's word. 0035 WRITES existing rows (the backfill) — say so in its header.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/sql/migrations/0035_scheduling_queue.sql` | Columns, `staffing_events`, the scheduler door, `extend_all_day_positions()`, backfill |
| `app/api/shows/send-to-scheduling/route.ts` | Send / take back (session; verified `shows` update; emails every scheduler). Replaces `approve-call` |
| `lib/callHandoffEmail.ts` | Reworded: "needs scheduling — 14 positions, Sep 4–9", to every scheduler |
| `components/SendToSchedulingButton.tsx` | Replaces `HandoffToSchedulerButton`: confirm → send; Sent state → Take back |
| `lib/schedulingQueue.ts` + `components/NeedsSchedulingList.tsx` | The "Needs scheduling" list on `/dashboard/schedule` |
| `lib/readyEmail.ts` | `compressDays`, `buildReadyEmail`, `sendReadyEmail` |
| `lib/showReadiness.ts` | `maybeSendReadyEmail(admin, showId)` — the one gate |
| `lib/staffingEvents.ts` | `logStaffingEvent(client, …)`, best-effort |
| `lib/digestEmail.ts` + `app/api/digest/route.ts` + `vercel.json` | The evening digest cron |
| `lib/daysChangedEmail.ts` + `app/api/crew/days-changed/route.ts` + `components/CrewChangeNotice.tsx` | Crew change notices |
| `components/AddDayButton.tsx` | All-day extension + notice |
| `scripts/test/rls.mts`, `scripts/test/schedule.mts`, `scripts/test/preview-show-emails.mts` | Proof |

---

### Task 1: Migration 0035 — the queue columns, the scheduler door, events, the extension function

**Files:**
- Create: `scripts/sql/migrations/0035_scheduling_queue.sql`
- Modify: `scripts/test/rls.mts` (before the `signed out` section)

**Interfaces:**
- Produces: `shows.sent_to_scheduling_at timestamptz`, `shows.sent_to_scheduling_by uuid`, `shows.ready_email_sent_at timestamptz`; table `staffing_events`; `extend_all_day_positions(p_show_id uuid, p_work_day_id uuid) returns table (crew_member_id, crew_member_name, role)`; `position_slot_flags` gains `crew_member_id`; the new scheduler arm in every visibility rule.

- [ ] **Step 1: Write the failing RLS checks.** Insert before `console.log('\n=== signed out, nothing is visible ===')`:

```ts
  console.log('\n=== schedulers see only shows sent to scheduling (0035) ===')
  {
    // dave gets the scheduling permission but is assigned only to showA.
    await q(`update memberships set can_manage_scheduling=true where profile_id=$1 and organization_id=$2`, [dave, orgA])
    await asUser(dave, async () => {
      const s = await q(`select count(*)::int n from shows where id=$1`, [showA2.id])
      check('a scheduler does NOT see a show that has not been sent', s[0].n === 0, `${s[0].n}`)
    })
    await q(`update shows set sent_to_scheduling_at=now() where id=$1`, [showA2.id])
    await asUser(dave, async () => {
      const s = await q(`select count(*)::int n from shows where id=$1`, [showA2.id])
      check('once sent, a scheduler sees it', s[0].n === 1, `${s[0].n}`)
      const t = await q(`select count(*)::int n from timecards where show_id=$1`, [showA2.id])
      check('and every timecard on it (PM-side)', t[0].n === 1, `${t[0].n}`)
      const pm = await q(`select count(*)::int n from my_pm_show_ids() f where f = $1`, [showA2.id])
      check('my_pm_show_ids() agrees', pm[0].n === 1, `${pm[0].n}`)
      const ins = await probe(`insert into staffing_events (show_id, kind, crew_member_name, role, days) values ($1,'booked','Sam','A1','Tue 3')`, [showA2.id])
      check('a scheduler can log a staffing event on a sent show', ins.ok && ins.n === 1, ins.ok ? `${ins.n}` : ins.code)
    })
    await q(`update memberships set can_manage_scheduling=false where profile_id=$1 and organization_id=$2`, [dave, orgA])
    await asUser(dave, async () => {
      const s = await q(`select count(*)::int n from shows where id=$1`, [showA2.id])
      check('without the permission a sent show is invisible again', s[0].n === 0, `${s[0].n}`)
      const ins = await probe(`insert into staffing_events (show_id, kind, crew_member_name, role, days) values ($1,'booked','Sam','A1','Tue 3')`, [showA2.id])
      check('and nobody can log events on a show they cannot see', !ins.ok || ins.n === 0, ins.ok ? `inserted ${ins.n}` : '')
    })
    await q(`update shows set scheduler_id=$2 where id=$1`, [showA2.id, dave])
    await asUser(dave, async () => {
      const s = await q(`select count(*)::int n from shows where id=$1`, [showA2.id])
      check('the old scheduler_id pointer no longer opens anything', s[0].n === 0, `${s[0].n}`)
    })
    await q(`update shows set scheduler_id=null, sent_to_scheduling_at=null where id=$1`, [showA2.id])
    await q(`delete from staffing_events where show_id=$1`, [showA2.id])
  }

  console.log('\n=== Add Day extends all-day people (0035) ===')
  {
    // A 2-day show, one room, an all-day A1 def and a show-day Camera def.
    const [sh] = await q(`insert into shows (organization_id, name, start_date, end_date, created_by) values ($1,'Extend Me','2026-11-02','2026-11-03',$2) returning id`, [orgA, alice])
    const [d1] = await q(`insert into work_days (show_id, date, day_number, activities) values ($1,'2026-11-02',1,'{show}') returning id`, [sh.id])
    const [d2] = await q(`insert into work_days (show_id, date, day_number, activities) values ($1,'2026-11-03',2,'{show}') returning id`, [sh.id])
    await q(`insert into rooms (work_day_id, name) values ($1,'Main'),($2,'Main')`, [d1.id, d2.id])
    await q(`insert into position_defs (show_id, room_name, role, count, day_kind, sort_order) values ($1,'Main','A1',1,'all',0),($1,'Main','Camera Op',1,'show',1)`, [sh.id])
    await q(`select sync_position_slots($1)`, [sh.id])
    // Book Sam into the A1 slot and Pat into the Camera slot on day 2.
    const slots = await q(`select p.id, p.room_id, p.role from crew_call_positions p join rooms r on r.id=p.room_id where r.work_day_id=$1`, [d2.id])
    for (const s of slots) {
      await q(`insert into timecards (room_id, crew_member_name, role, call_position_id, booking_status) values ($1,$2,$3,$4,'confirmed')`,
        [s.room_id, s.role === 'A1' ? 'Sam' : 'Pat', s.role, s.id])
    }
    // Day 3 arrives, tagged load-out (not a show day).
    const [d3] = await q(`insert into work_days (show_id, date, day_number, activities) values ($1,'2026-11-04',3,'{load_out}') returning id`, [sh.id])
    await q(`insert into rooms (work_day_id, name) values ($1,'Main')`, [d3.id])
    await q(`select sync_position_slots($1)`, [sh.id])
    const n = await asUser(alice, async () => (await q(`select count(*)::int n from extend_all_day_positions($1,$2)`, [sh.id, d3.id]))[0].n)
    const who = await q(`select t.crew_member_name from timecards t join rooms r on r.id=t.room_id where r.work_day_id=$1 order by 1`, [d3.id])
    check('extends exactly the all-day person, not the show-day one', n === 1 && who.length === 1 && who[0].crew_member_name === 'Sam', JSON.stringify(who))
    const again = await asUser(alice, async () => (await q(`select count(*)::int n from extend_all_day_positions($1,$2)`, [sh.id, d3.id]))[0].n)
    check('running it twice adds nobody twice', again === 0, `${again}`)
    await q(`delete from shows where id=$1`, [sh.id])
  }
```

- [ ] **Step 2: Run to see them fail.** `npm run test:rls` → the block errors on `sent_to_scheduling_at` (column missing). Expected.

- [ ] **Step 3: Write the migration.**

```sql
-- Piece C of the 2026-09-07 show-flow spec: the scheduling QUEUE.
--
-- A show is no longer handed to ONE scheduler. "Send to scheduler" stamps
-- sent_to_scheduling_at and emails everyone with can_manage_scheduling; from
-- then on every scheduler is PM-side on it. The scheduler_id arm of every
-- visibility rule becomes "holds the permission AND the show has been sent".
-- scheduler_id / call_approved_at / call_approved_by stay as history and are
-- written by nothing after this migration.
--
-- WRITES EXISTING ROWS: sent_to_scheduling_at is backfilled from
-- call_approved_at, so a show handed off before this keeps its state and its
-- scheduler keeps seeing it (as long as they hold the permission — the
-- superadmin panel grants it per member).
--
-- staffing_events feeds the evening digest; extend_all_day_positions() is Add
-- Day's "extend everyone on all-day positions" — SECURITY INVOKER, so RLS and
-- the timecards write policy still decide who may call it.

-- 1. Columns.
alter table public.shows
  add column if not exists sent_to_scheduling_at timestamptz null,
  add column if not exists sent_to_scheduling_by uuid null references public.profiles(id) on delete set null,
  add column if not exists ready_email_sent_at timestamptz null;
update public.shows set sent_to_scheduling_at = call_approved_at, sent_to_scheduling_by = call_approved_by
  where call_approved_at is not null and sent_to_scheduling_at is null;
create index if not exists shows_sent_to_scheduling_idx on public.shows (sent_to_scheduling_at) where sent_to_scheduling_at is not null;

-- 2. The scheduler door, everywhere the old arm lived.
alter policy "Users see their org shows" on public.shows
  using (
    organization_id = (select my_organization_id())
    and (
      (select can_see_all_shows())
      or id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or created_by = (select auth.uid())
      or ((select my_perm('can_manage_scheduling')) and sent_to_scheduling_at is not null)
      or id in (select show_id from show_crew_access where profile_id = (select auth.uid()))
    )
  );

create or replace function public.my_pm_show_ids() returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select s.id from shows s
  where s.organization_id = my_organization_id()
    and ( can_see_all_shows()
       or s.created_by = auth.uid()
       or (my_perm('can_manage_scheduling') and s.sent_to_scheduling_at is not null)
       or s.id in (select show_id from show_assignments where profile_id = auth.uid()) );
$$;

alter policy "Users see timecards for their shows" on public.timecards
  using (
    show_id in (select id from shows)
    and (
      (select can_see_all_shows())
      or crew_member_id in (select my_crew_member_ids())
      or show_id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or show_id in (select id from shows where created_by = (select auth.uid())
                       or ((select my_perm('can_manage_scheduling')) and sent_to_scheduling_at is not null))
    )
  );

alter policy "Users see punches for their timecards" on public.punches
  using (
    show_id in (select id from shows)
    and (
      (select can_see_all_shows())
      or show_id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or show_id in (select id from shows where created_by = (select auth.uid())
                       or ((select my_perm('can_manage_scheduling')) and sent_to_scheduling_at is not null))
      or timecard_id in (select id from timecards where crew_member_id in (select my_crew_member_ids()))
    )
  );

create or replace view public.timecard_day_rates with (security_invoker = false) as
  select t.id as timecard_id, w.show_id, t.day_rate
  from timecards t
  join rooms r on r.id = t.room_id
  join work_days w on w.id = r.work_day_id
  join shows s on s.id = w.show_id
  where s.organization_id = (select my_organization_id())
    and (select my_perm('can_view_pay_rates'))
    and (
      (select can_see_all_shows())
      or exists (select 1 from show_assignments sa
                  where sa.show_id = s.id and sa.profile_id = (select auth.uid()))
      or s.created_by = (select auth.uid())
      or ((select my_perm('can_manage_scheduling')) and s.sent_to_scheduling_at is not null)
    );

-- 3. Staffing events — the digest's diary. Written by the app (routes and the
--    tracker's staffing writes), read by the digest cron (service role), and
--    marked sent there. organization_id is denormalized by trigger, the same
--    shape as show_assignments, so the policy never has to walk to shows for
--    the org.
create table if not exists public.staffing_events (
  id               uuid primary key default gen_random_uuid(),
  show_id          uuid not null references public.shows(id) on delete cascade,
  organization_id  uuid null references public.organizations(id) on delete cascade,
  at               timestamptz not null default now(),
  kind             text not null check (kind in ('booked','accepted','declined','released','days_changed','moved','extended')),
  crew_member_id   uuid null references public.crew_members(id) on delete set null,
  crew_member_name text not null,
  role             text null,
  days             text null,
  actor            uuid null references public.profiles(id) on delete set null,
  sent_at          timestamptz null
);
create index if not exists staffing_events_unsent_idx on public.staffing_events (show_id) where sent_at is null;
alter table public.staffing_events enable row level security;
alter table public.staffing_events force row level security;
create or replace function public.set_staffing_event_organization_id() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin select s.organization_id into new.organization_id from shows s where s.id = new.show_id; return new; end; $$;
drop trigger if exists set_staffing_event_organization_id on public.staffing_events;
create trigger set_staffing_event_organization_id before insert on public.staffing_events
  for each row execute function public.set_staffing_event_organization_id();
drop policy if exists "Users see staffing events for their shows" on public.staffing_events;
create policy "Users see staffing events for their shows" on public.staffing_events
  for select using (show_id in (select id from shows));
drop policy if exists "Users log staffing events for their shows" on public.staffing_events;
create policy "Users log staffing events for their shows" on public.staffing_events
  for insert with check (show_id in (select id from shows));
grant select, insert on public.staffing_events to authenticated;

-- 4. The flags view learns crew_member_id, so a crew change notice can name
--    the person (Task 6). Same columns as 0034 plus one.
create or replace view public.position_slot_flags with (security_invoker = true) as
  select p.id as slot_id, wd.show_id, p.position_def_id, rm.name as room_name, wd.date, p.role,
         t.id as timecard_id, t.crew_member_id, t.crew_member_name
  from crew_call_positions p
  join position_defs d on d.id = p.position_def_id
  join rooms rm on rm.id = p.room_id
  join work_days wd on wd.id = rm.work_day_id
  join timecards t on t.call_position_id = p.id and t.booking_status is distinct from 'declined'
  where not (rm.name = d.room_name and position_def_wants(d.day_kind, d.custom_dates, wd.activities, wd.date));

-- 5. Add Day: extend everyone on an all-day position to the new day. For each
--    definition with day_kind 'all', every person booked into one of its slots
--    on the day BEFORE the new one gets the first open slot of that definition
--    on the new day. Skips anyone already in that room that day. Returns the
--    number of people extended. SECURITY INVOKER: the timecards INSERT policy
--    (can_edit_timecards) applies.
create or replace function public.extend_all_day_positions(p_show_id uuid, p_work_day_id uuid)
returns table (crew_member_id uuid, crew_member_name text, role text)
language plpgsql as $$
declare
  v_new  public.work_days%rowtype;
  v_prev public.work_days%rowtype;
  r record;
  v_slot uuid;
  v_room uuid;
begin
  select * into v_new from work_days where id = p_work_day_id and show_id = p_show_id;
  if v_new.id is null then raise exception 'That day is not on this show.'; end if;
  select * into v_prev from work_days where show_id = p_show_id and date < v_new.date order by date desc limit 1;
  if v_prev.id is null then return; end if;

  for r in
    select d.id as def_id, t.crew_member_id, t.crew_member_name, t.role
    from position_defs d
    join rooms rp on rp.work_day_id = v_prev.id and rp.name = d.room_name
    join crew_call_positions pp on pp.room_id = rp.id and pp.position_def_id = d.id
    join timecards t on t.call_position_id = pp.id and t.booking_status is distinct from 'declined'
    where d.show_id = p_show_id and d.day_kind = 'all'
    order by d.sort_order, t.crew_member_name
  loop
    select p.id, p.room_id into v_slot, v_room
    from crew_call_positions p join rooms rn on rn.id = p.room_id
    where rn.work_day_id = v_new.id and p.position_def_id = r.def_id
      and not exists (select 1 from timecards x where x.call_position_id = p.id and x.booking_status is distinct from 'declined')
      and (r.crew_member_id is null or not exists (select 1 from timecards y where y.room_id = p.room_id and y.crew_member_id = r.crew_member_id))
    order by p.created_at limit 1;
    if v_slot is null then continue; end if;
    insert into timecards (room_id, crew_member_id, crew_member_name, role, call_position_id, booking_status)
    values (v_room, r.crew_member_id, r.crew_member_name, r.role, v_slot, 'pencilled');
    crew_member_id := r.crew_member_id; crew_member_name := r.crew_member_name; role := r.role;
    return next;
  end loop;
  return;
end; $$;
revoke execute on function public.extend_all_day_positions(uuid, uuid) from public, anon;
grant execute on function public.extend_all_day_positions(uuid, uuid) to authenticated, service_role;
```

- [ ] **Step 4: Apply on dev and run the checks.** `npm run db:migrate` (dev) → `npm run test:rls`. Expected: the 9 new checks green, 117 total. If `my_pm_show_ids` ordering surprises you: the rls fixture `sam` is assigned to showA2 (manual), so dave's "does NOT see" checks are about dave only.

- [ ] **Step 5: Commit.**

```bash
git add scripts/sql/migrations/0035_scheduling_queue.sql scripts/test/rls.mts
git commit -m "Migration 0035: the scheduling queue — sent_to_scheduling_at, the permission-based scheduler door, staffing_events, extend_all_day_positions().

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Send to scheduling — the route, the email, the button, the readers

**Files:**
- Create: `app/api/shows/send-to-scheduling/route.ts`, `components/SendToSchedulingButton.tsx`, `scripts/test/preview-show-emails.mts`
- Delete: `app/api/shows/approve-call/route.ts`, `components/HandoffToSchedulerButton.tsx`
- Modify: `lib/callHandoffEmail.ts`, `components/EditShowClient.tsx:552-560`, `app/dashboard/shows/[id]/edit/page.tsx:101-116,176-182`, `lib/showStatus.ts:24-26,74`, `app/dashboard/page.tsx:141-149,190`, `components/ShowsListClient.tsx:47`, `app/api/bookings/respond/route.ts:63-66,110-117`, `package.json`

**Interfaces:**
- Produces: `POST /api/shows/send-to-scheduling` body `{ showId, takeBack?: boolean }` → `{ ok, sentTo: number, warning? }`. `buildCallHandoffEmail({ to, recipientName, showName, venue, startDate, endDate, organizationName, sentByName, callSize, link })`. `SendToSchedulingButton({ showId, sentAt, positionCount, callSize, initialOpen })`.

- [ ] **Step 1: The email, reworded for a queue.** In `lib/callHandoffEmail.ts` rename `schedulerName` → `recipientName` and `approvedByName` → `sentByName`; subject `${organizationName}: ${showName} needs scheduling — ${callSize}, ${dates}` where `dates` uses `describeShowDates` from `lib/pmInviteEmail.ts` (import it; drop the local `fmtDate`). Body first line: `${showName} has been sent to scheduling${sentBy}. Any scheduler can fill its positions; it's first come, first served.` Keep the table and the button ("Open the show"). Update `sendCallHandoffEmail` accordingly.

- [ ] **Step 2: The route.** Create `app/api/shows/send-to-scheduling/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendCallHandoffEmail } from '@/lib/callHandoffEmail'
import { summarizeCall, describeCallSize } from '@/lib/crewCall'
import { siteOrigin } from '@/lib/siteOrigin'

// Send a show to scheduling — to EVERYONE with the permission — or take it back.
//
// AUTHORIZATION IS THE shows UPDATE POLICY: the stamp is written through the
// caller's session as a verified update. The service role is used only to
// read the recipient list afterwards (memberships of other people), never to
// decide anything.
//
// Nobody owns a sent show. scheduler_id / call_approved_at are history and
// are not written here.

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!canUseScheduling(user)) {
    return NextResponse.json({ error: 'Scheduling is not enabled for this account.' }, { status: 403 })
  }

  let showId: string | undefined
  let takeBack: boolean | undefined
  try { ({ showId, takeBack } = await request.json()) } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!showId) return NextResponse.json({ error: 'Missing showId.' }, { status: 400 })

  const { data: show } = await supabase
    .from('shows')
    .select('id, name, venue, start_date, end_date, organization_id, sent_to_scheduling_at, finalized_at')
    .eq('id', showId).maybeSingle()
  if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 })
  if (show.finalized_at) return NextResponse.json({ error: 'This show has been closed out.' }, { status: 400 })

  const now = new Date().toISOString()

  if (takeBack) {
    if (!show.sent_to_scheduling_at) return NextResponse.json({ error: 'This show is not with scheduling.' }, { status: 400 })
    const { data: back } = await supabase.from('shows')
      .update({ sent_to_scheduling_at: null, sent_to_scheduling_by: null }).eq('id', show.id).select('id')
    if (!back?.length) return NextResponse.json({ error: 'You do not have permission to change this show.' }, { status: 403 })
    return NextResponse.json({ ok: true, sentTo: 0 })
  }

  if (show.sent_to_scheduling_at) return NextResponse.json({ error: 'This show is already with scheduling.' }, { status: 400 })

  // Something to schedule. Counted per day, never per row (lib/crewCall.ts).
  const { data: positionRows } = await supabase
    .from('crew_call_positions')
    .select('id, rooms!inner(work_days!inner(date, show_id))')
    .eq('rooms.work_days.show_id', showId)
  const call = summarizeCall((positionRows ?? []).map((p: any) => {
    const room = Array.isArray(p.rooms) ? p.rooms[0] : p.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    return { date: wd?.date }
  }).filter((r: any) => r.date))
  if (!call.total) return NextResponse.json({ error: 'Add at least one position before sending this show to scheduling.' }, { status: 400 })

  const { data: updated, error: updateError } = await supabase.from('shows')
    .update({ sent_to_scheduling_at: now, sent_to_scheduling_by: user.id }).eq('id', show.id).select('id')
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })
  if (!updated?.length) return NextResponse.json({ error: 'You do not have permission to send this show.' }, { status: 403 })

  // Everyone with the permission, in THIS company, live. Read with the
  // service role: the caller may not hold can_manage_users, and this is a
  // notification list, not a decision.
  const admin = createAdminClient()
  const [{ data: schedulers }, { data: org }] = await Promise.all([
    admin.from('memberships').select('profile_id, profiles(full_name, email)')
      .eq('organization_id', show.organization_id).eq('can_manage_scheduling', true).is('deactivated_at', null),
    admin.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
  ])
  const recipients = ((schedulers ?? []) as any[]).map(m => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    return { name: (p?.full_name ?? null) as string | null, email: (p?.email ?? null) as string | null }
  }).filter(r => r.email)
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, sentTo: 0, warning: 'Sent, but nobody in this company has the scheduling permission yet, so no email went out.' })
  }

  const origin = siteOrigin()
  const failures: string[] = []
  for (const r of recipients) {
    const result = await sendCallHandoffEmail({
      to: r.email!, recipientName: r.name, showName: show.name, venue: show.venue,
      startDate: show.start_date, endDate: show.end_date,
      organizationName: org?.name ?? 'your team', sentByName: user.fullName,
      callSize: describeCallSize(call), link: `${origin}/dashboard/shows/${show.id}`,
    })
    if (result.error) failures.push(r.email!)
  }
  if (failures.length) {
    return NextResponse.json({ ok: true, sentTo: recipients.length - failures.length, warning: `Sent, but the email did not reach ${failures.join(', ')}.` })
  }
  return NextResponse.json({ ok: true, sentTo: recipients.length })
}
```

Delete `app/api/shows/approve-call/route.ts`.

- [ ] **Step 3: The button.** Create `components/SendToSchedulingButton.tsx` (delete `HandoffToSchedulerButton.tsx`). No member picker. Not sent: a ghost Button "Send to scheduler" (disabled with the title `Add positions first — there is nothing to schedule yet.` when `positionCount === 0`); clicking opens an in-place confirm (`border-l-[3px] border-accent`, no dialog): `Send ${callSize} to scheduling? Everyone with the scheduling permission gets an email, and any of them can fill the positions.` → **Send** / Cancel. `initialOpen` opens the confirm on mount when not yet sent and `positionCount > 0`. On success: notice `Sent to ${n} scheduler${n===1?'':'s'}.` or the route's `warning`; `router.refresh()`. Sent: `<Chip tone="good">With scheduling</Chip> since {fmt(sentAt)}` and a text link **Take back** with `confirm('Take this show back from scheduling? Schedulers lose sight of it until it is sent again.')` → POST `{ showId, takeBack: true }` → refresh.

- [ ] **Step 4: Readers.**
  - `lib/showStatus.ts`: add `sent_to_scheduling_at?: string | null` to the input; last line becomes `return show.sent_to_scheduling_at ? 'staffing' : 'new'`; drop `call_approved_at` from the type and its comment.
  - `app/dashboard/page.tsx`: delete the scheduler-name lookup (lines 141–149); `schedulerName` → remove from the row; pass `sent_to_scheduling_at` through `showStatus` (it already spreads `show`).
  - `components/ShowsListClient.tsx`: remove `schedulerName` from `ShowRow` and any render of it.
  - `app/dashboard/shows/[id]/edit/page.tsx`: remove the `scheduler` profile lookup; `scheduling` prop becomes `{ sentAt: show.sent_to_scheduling_at ?? null, positionCount, callSize, openHandoff }`.
  - `components/EditShowClient.tsx`: import and render `SendToSchedulingButton` with `showId, sentAt, positionCount, callSize, initialOpen={scheduling.openHandoff}`; the section title stays "Scheduling".
  - `app/api/bookings/respond/route.ts`: the decline notice goes to every scheduler when the show is sent (`sent_to_scheduling_at` set: `memberships` where `can_manage_scheduling` via `admin`), else to `created_by`. Select `sent_to_scheduling_at, organization_id` instead of `scheduler_id`. One email per recipient.

- [ ] **Step 5: Preview script.** Create `scripts/test/preview-show-emails.mts` printing `buildCallHandoffEmail` for the Northwind example (recipient "Sam Okafor", sent by "Dan Smith", `describeCallSize` of a 14-position, 6-day call), and add `"preview:emails": "node --no-warnings --import ./scripts/test/alias-loader.mjs --experimental-strip-types scripts/test/preview-show-emails.mts"` to `package.json`. Tasks 4–6 add their emails to this same script.

- [ ] **Step 6: Prove on dev.** `npx tsc --noEmit -p .` clean. Sign in as the admin on dev; seed a throwaway show with positions (SQL, as in Task 3 of the piece-B plan); Edit Show → Send to scheduler → confirm → the notice says `Sent to N schedulers`; SQL: `sent_to_scheduling_at` set, `scheduler_id` still null. Shows list: status chip reads Staffing. Give `crewtest@example.test` `can_manage_scheduling=true` (SQL), sign the pane in as crewtest → the show is in their list and opens PM-side; Take back → gone from their list. Restore crewtest, delete the show.

- [ ] **Step 7: Build, commit.**

```bash
npm run build && rm -rf .next
git add app/api/shows/send-to-scheduling components/SendToSchedulingButton.tsx lib/callHandoffEmail.ts components/EditShowClient.tsx "app/dashboard/shows/[id]/edit/page.tsx" lib/showStatus.ts app/dashboard/page.tsx components/ShowsListClient.tsx app/api/bookings/respond/route.ts scripts/test/preview-show-emails.mts package.json
git rm -q app/api/shows/approve-call/route.ts components/HandoffToSchedulerButton.tsx
git commit -m "Send to scheduling goes to everyone with the permission; schedulers see only sent shows; take back.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 3: The "Needs scheduling" list on the Schedule screen

**Files:**
- Create: `lib/schedulingQueue.ts`, `components/NeedsSchedulingList.tsx`
- Modify: `app/dashboard/schedule/page.tsx` (above the window controls), `scripts/test/schedule.mts`

**Interfaces:**
- Produces: `fetchSchedulingQueue(supabase) → QueueRow[]` where `QueueRow = { id, name, venue, startDate, endDate, sentAt, openSlots, totalSlots, waiting, flags }`; pure `summarizeQueue(slots: {showId, filled: boolean, status: string|null}[], flags: {showId}[]) → Map<showId, {open,total,waiting,flags}>`.

- [ ] **Step 1: Failing test** in `scripts/test/schedule.mts` (import `summarizeQueue` from `../../lib/schedulingQueue.ts`):

```ts
console.log('\n--- scheduling queue summary ---')
{
  const m = summarizeQueue(
    [
      { showId: 'a', filled: true, status: 'confirmed' },
      { showId: 'a', filled: true, status: 'invited' },
      { showId: 'a', filled: false, status: null },
      { showId: 'b', filled: true, status: 'pencilled' },
    ],
    [{ showId: 'a' }, { showId: 'a' }],
  )
  check('show a: 1 open of 3, 1 waiting, 2 flags', m.get('a'), { open: 1, total: 3, waiting: 1, flags: 2 })
  check('show b: full but 1 waiting (pencilled counts)', m.get('b'), { open: 0, total: 1, waiting: 1, flags: 0 })
}
```

- [ ] **Step 2: Run** `npm run test:schedule` → fails (module missing).

- [ ] **Step 3: Implement** `lib/schedulingQueue.ts`:

```ts
// The scheduling queue: sent shows that still need a scheduler's hands.
// Plain module. Scoping is RLS: a scheduler's session only returns sent shows.
import { liveBookings } from '@/lib/timecardFields'

export type QueueRow = {
  id: string; name: string; venue: string | null; startDate: string; endDate: string; sentAt: string
  openSlots: number; totalSlots: number; waiting: number; flags: number
}
export type QueueSummary = { open: number; total: number; waiting: number; flags: number }

/** Pure: per show, open slots, slots total, bookings waiting on a reply, flags. */
export function summarizeQueue(
  slots: { showId: string; filled: boolean; status: string | null }[],
  flags: { showId: string }[],
): Map<string, QueueSummary> {
  const m = new Map<string, QueueSummary>()
  const at = (id: string) => m.get(id) ?? (m.set(id, { open: 0, total: 0, waiting: 0, flags: 0 }), m.get(id)!)
  for (const s of slots) {
    const q = at(s.showId); q.total++
    if (!s.filled) q.open++
    else if (s.status === 'pencilled' || s.status === 'invited') q.waiting++
  }
  for (const f of flags) at(f.showId).flags++
  return m
}

export async function fetchSchedulingQueue(supabase: { from: (t: string) => any }): Promise<QueueRow[]> {
  const { data: shows } = await supabase.from('shows')
    .select('id, name, venue, start_date, end_date, sent_to_scheduling_at')
    .not('sent_to_scheduling_at', 'is', null).is('finalized_at', null).not('archived', 'is', true)
    .order('sent_to_scheduling_at', { ascending: true })
  const ids = (shows ?? []).map((s: any) => s.id as string)
  if (!ids.length) return []
  const [{ data: slots }, { data: flags }] = await Promise.all([
    supabase.from('crew_call_positions')
      .select('id, rooms!inner(show_id), timecards(booking_status)').in('rooms.show_id', ids),
    supabase.from('position_slot_flags').select('show_id').in('show_id', ids),
  ])
  const summary = summarizeQueue(
    ((slots ?? []) as any[]).map(p => {
      const room = Array.isArray(p.rooms) ? p.rooms[0] : p.rooms
      const live = ((p.timecards ?? []) as any[]).find(t => t.booking_status !== 'declined')
      return { showId: room?.show_id, filled: !!live, status: live?.booking_status ?? null }
    }),
    ((flags ?? []) as any[]).map(f => ({ showId: f.show_id })),
  )
  return (shows ?? []).map((s: any) => {
    const q = summary.get(s.id) ?? { open: 0, total: 0, waiting: 0, flags: 0 }
    return { id: s.id, name: s.name, venue: s.venue ?? null, startDate: s.start_date, endDate: s.end_date,
      sentAt: s.sent_to_scheduling_at, openSlots: q.open, totalSlots: q.total, waiting: q.waiting, flags: q.flags }
  }).filter((r: QueueRow) => r.openSlots > 0 || r.flags > 0 || r.waiting > 0)
}
```
(`liveBookings` import is unused here — remove it; the filter is done per slot above because a slot's own row set is what matters.)

- [ ] **Step 4: The component and the page.** `components/NeedsSchedulingList.tsx` (server component, no `'use client'`): a light table header strip (`bg-surface-2 border-b-2 border-ink`, NOT a band — the page already has one) titled "Needs scheduling", one row per show: name (link to `/dashboard/shows/${id}`), `describeShowDates`, then `${openSlots} open of ${totalSlots}` · `${waiting} waiting` (only when > 0) · `${flags} to sort out` in `text-ot` (only when > 0), and "sent N days ago". Empty list → render nothing. In `app/dashboard/schedule/page.tsx` add `fetchSchedulingQueue(supabase)` to the `Promise.all` and render `<NeedsSchedulingList rows={queue} />` between the masthead and the window controls.

- [ ] **Step 5: Prove on dev.** With the throwaway show sent: `/dashboard/schedule` lists it with `20 open of 20`; fill one slot → `19 open`; retag a booked day → `1 to sort out`. Take back → the list disappears.

- [ ] **Step 6: Build, commit.**

```bash
npm run build && rm -rf .next && npm run test:schedule
git add lib/schedulingQueue.ts components/NeedsSchedulingList.tsx app/dashboard/schedule/page.tsx scripts/test/schedule.mts
git commit -m "Schedule screen: the Needs-scheduling list — sent shows with open slots, replies waiting, or flags.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 4: The ready email

**Files:**
- Create: `lib/readyEmail.ts`, `lib/showReadiness.ts`
- Modify: `app/api/bookings/respond/route.ts` (after the timecards update), `app/api/pm/accept/route.ts` (after the stamps), `scripts/test/schedule.mts`, `scripts/test/preview-show-emails.mts`

**Interfaces:**
- Produces: `compressDays(dates: string[]) → string` ("Tue–Thu", "Tue, Thu", "Tue 3 – Thu 5" when the run crosses a week — always `Weekday D` tokens); `buildReadyEmail(input: ReadyEmailInput) → { subject, text, html }`; `sendReadyEmail(input) → { error? }`; `maybeSendReadyEmail(admin, showId) → { sent: boolean; reason: string }`.
- `ReadyEmailInput = { to, pmName, showName, dates, venue, orgName, link, days: { date: string; label: string; rooms: { name: string; people: { name: string; role: string | null; phone: string | null }[] }[] }[], perPerson: { name: string; role: string | null; days: string }[], waiting: number }`.

- [ ] **Step 1: Failing tests** in `scripts/test/schedule.mts`:

```ts
console.log('\n--- ready email: day compression ---')
{
  check('consecutive → range', compressDays(['2026-09-08','2026-09-09','2026-09-10']), 'Tue 8 – Thu 10')
  check('gap → list', compressDays(['2026-09-08','2026-09-10']), 'Tue 8, Thu 10')
  check('one day', compressDays(['2026-09-08']), 'Tue 8')
  check('unsorted input is sorted', compressDays(['2026-09-10','2026-09-08','2026-09-09']), 'Tue 8 – Thu 10')
  const { subject, text } = buildReadyEmail({
    to: 'pm@x.test', pmName: 'Sam Okafor', showName: 'Northwind', dates: 'Sep 8–10', venue: 'Moscone West',
    orgName: 'Wood & Waves', link: 'https://crewtracker.app/dashboard/shows/1',
    days: [{ date: '2026-09-08', label: 'Load-in', rooms: [{ name: 'Ballroom', people: [{ name: 'Alex Reyes', role: 'A1', phone: '(312) 555-0100' }] }] }],
    perPerson: [{ name: 'Alex Reyes', role: 'A1', days: 'Tue 8 – Thu 10' }], waiting: 0,
  })
  check('subject names the show and says it is staffed', subject, 'Wood & Waves: Northwind is fully staffed')
  check('roster line carries name, role, phone', text.includes('Alex Reyes · A1 · (312) 555-0100'), true)
  check('per-person line', text.includes('Alex Reyes · A1 · Tue 8 – Thu 10'), true)
  check('waiting count', text.includes('0 waiting on a reply'), true)
}
```

- [ ] **Step 2: Run** → fails (module missing).

- [ ] **Step 3: Implement** `lib/readyEmail.ts`: `compressDays` (sort, group runs of consecutive dates via `addDays` from `lib/datetime`, format each token as `${weekday short} ${dayOfMonth}` built by hand — en-US puts the number first otherwise, see `describeDefDays`), `buildReadyEmail` (text: greeting; `${showName} · ${dates} · ${venue} is fully staffed.`; `${waiting} waiting on a reply`; a blank line; per day `── ${fmtDate(date)} · ${label}` then per room `${room.name}` and one line per person `  ${name} · ${role ?? 'Crew'} · ${phone ?? 'no phone on file'}`; blank; `Everyone's days:` then `${name} · ${role} · ${days}`; link; sign-off) and matching html (same content, `<h3>` per day, `<p>` per room, `<ul>` per people), `sendReadyEmail` in the per-call Resend shape from `lib/pmInviteEmail.ts`.

- [ ] **Step 4: The gate.** `lib/showReadiness.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildReadyEmail, compressDays, sendReadyEmail } from '@/lib/readyEmail'
import { describeShowDates } from '@/lib/pmInviteEmail'
import { dayLabel } from '@/lib/dayActivities'
import { siteOrigin } from '@/lib/siteOrigin'

// THE ONE PLACE the ready email is decided. Called after anything that can
// complete a show: a crew confirmation (/api/bookings/respond) and a PM
// accepting (/api/pm/accept). Idempotent by ready_email_sent_at; a show that
// later reopens a slot does not unsend or resend it.
export async function maybeSendReadyEmail(admin: SupabaseClient, showId: string): Promise<{ sent: boolean; reason: string }> {
  const { data: show } = await admin.from('shows')
    .select('id, name, venue, city_state, start_date, end_date, organization_id, pm_profile_id, pm_accepted_at, ready_email_sent_at, finalized_at, archived')
    .eq('id', showId).maybeSingle()
  if (!show) return { sent: false, reason: 'no show' }
  if (show.ready_email_sent_at) return { sent: false, reason: 'already sent' }
  if (!show.pm_profile_id || !show.pm_accepted_at) return { sent: false, reason: 'no accepted PM' }
  if (show.finalized_at || show.archived) return { sent: false, reason: 'closed' }

  const [{ data: slots }, { data: cards }] = await Promise.all([
    admin.from('crew_call_positions').select('id, rooms!inner(show_id), timecards(booking_status)').eq('rooms.show_id', showId),
    admin.from('timecards')
      .select('id, crew_member_name, role, booking_status, crew_member_id, crew_members(phone), rooms!inner(name, work_days!inner(date, activities))')
      .eq('show_id', showId).neq('booking_status', 'declined'),
  ])
  const open = ((slots ?? []) as any[]).filter(p => !((p.timecards ?? []) as any[]).some(t => t.booking_status !== 'declined')).length
  const waiting = ((cards ?? []) as any[]).filter(t => t.booking_status === 'pencilled' || t.booking_status === 'invited').length
  if (open > 0 || waiting > 0) return { sent: false, reason: `${open} open, ${waiting} waiting` }

  const [{ data: pm }, { data: org }] = await Promise.all([
    admin.from('profiles').select('email, full_name').eq('id', show.pm_profile_id).maybeSingle(),
    admin.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
  ])
  if (!pm?.email) return { sent: false, reason: 'PM has no email' }

  // Roster by day and room; each person's days across the show.
  const byDate = new Map<string, { label: string; rooms: Map<string, { name: string; role: string | null; phone: string | null }[]> }>()
  const daysByPerson = new Map<string, { name: string; role: string | null; dates: Set<string> }>()
  for (const t of (cards ?? []) as any[]) {
    const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    const cm = Array.isArray(t.crew_members) ? t.crew_members[0] : t.crew_members
    if (!wd?.date) continue
    const day = byDate.get(wd.date) ?? { label: dayLabel(wd.activities ?? []), rooms: new Map() }
    const people = day.rooms.get(room.name) ?? []
    people.push({ name: t.crew_member_name, role: t.role ?? null, phone: cm?.phone ?? null })
    day.rooms.set(room.name, people); byDate.set(wd.date, day)
    const key = `${t.crew_member_name}|${t.role ?? ''}`
    const p = daysByPerson.get(key) ?? { name: t.crew_member_name, role: t.role ?? null, dates: new Set<string>() }
    p.dates.add(wd.date); daysByPerson.set(key, p)
  }
  const input = {
    to: pm.email, pmName: pm.full_name ?? null, showName: show.name,
    dates: describeShowDates(show.start_date, show.end_date), venue: show.venue || show.city_state || null,
    orgName: org?.name ?? 'Your company', link: `${siteOrigin()}/dashboard/shows/${show.id}`,
    days: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({
      date, label: d.label,
      rooms: [...d.rooms.entries()].map(([name, people]) => ({ name, people: people.sort((x, y) => x.name.localeCompare(y.name)) })),
    })),
    perPerson: [...daysByPerson.values()].sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ name: p.name, role: p.role, days: compressDays([...p.dates]) })),
    waiting: 0,
  }
  const { error } = await sendReadyEmail(input)
  if (error) return { sent: false, reason: error }
  await admin.from('shows').update({ ready_email_sent_at: new Date().toISOString() }).eq('id', show.id)
  return { sent: true, reason: 'sent' }
}
```

- [ ] **Step 5: Call it.** In `app/api/bookings/respond/route.ts` after the timecards update, when `response === 'confirmed'`: `await maybeSendReadyEmail(admin, invite.show_id)` (failure never fails the response — it returns, it does not throw). In `app/api/pm/accept/route.ts` after the two stamps: `await maybeSendReadyEmail(admin, show.id)`.

- [ ] **Step 6: Preview.** Add the ready email to `preview-show-emails.mts` with a 3-day, 2-room example. Read it.

- [ ] **Step 7: Prove on dev.** Throwaway show with 2 defs, PM named and accepted (crewtest via the `/pm/<token>` page in the pane). Fill every slot via SQL as `confirmed` except one; `select maybe…` cannot be called from SQL, so trigger it: confirm the last one through `/api/bookings/respond` with a real `booking_invites` token (insert one by SQL for that crew member, POST `{ token, response: 'confirmed' }` with curl). Expect: `ready_email_sent_at` set, one email. Reopen a slot (delete a timecard) → nothing changes. Second path: a show that is full before the PM accepts → accept → `ready_email_sent_at` set on accept.

- [ ] **Step 8: Build, commit.**

```bash
npm run build && rm -rf .next && npm run test:schedule
git add lib/readyEmail.ts lib/showReadiness.ts app/api/bookings/respond/route.ts app/api/pm/accept/route.ts scripts/test/schedule.mts scripts/test/preview-show-emails.mts
git commit -m "The ready email: sent once, automatically, to an accepted PM when the last position is confirmed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 5: Staffing events and the evening digest

**Files:**
- Create: `lib/staffingEvents.ts`, `lib/digestEmail.ts`, `app/api/digest/route.ts`
- Modify: `vercel.json`, `proxy.ts` (allowlist `/api/digest` beside `/api/keepalive`), `app/api/bookings/respond/route.ts`, `components/FillPositionPicker.tsx`, `components/PositionDefsSection.tsx`, `components/RoomActionsMenu.tsx`, `components/StaffRoomModal.tsx`, `scripts/test/schedule.mts`, `scripts/test/preview-show-emails.mts`

**Interfaces:**
- Produces: `logStaffingEvent(client, { showId, kind, crewMemberId?, crewMemberName, role?, days? }) → Promise<void>` (best-effort: logs to console on failure, never throws); `buildDigestEmail({ to, pmName, showName, date, link, lines: { time: string; text: string; status: 'accepted' | 'waiting on reply' | 'declined' | 'released' | null }[] })`.
- Digest status per line = the CURRENT state: `confirmed → accepted`, `pencilled|invited → waiting on reply`, `declined → declined`, no live timecard for that person on the show → `released`.

- [ ] **Step 1: Failing test** in `schedule.mts` (import `buildDigestEmail`, `describeEvent` from `../../lib/digestEmail.ts`):

```ts
console.log('\n--- evening digest ---')
{
  check('booked line', describeEvent({ kind: 'booked', crewMemberName: 'Alex Reyes', role: 'A1', days: 'Tue 8 – Thu 10' }), 'Alex Reyes booked as A1, Tue 8 – Thu 10')
  check('declined line', describeEvent({ kind: 'declined', crewMemberName: 'Bo Ellery', role: 'Stagehand', days: null }), 'Bo Ellery declined Stagehand')
  check('moved line', describeEvent({ kind: 'moved', crewMemberName: 'Bo Ellery', role: 'Stagehand', days: 'Mon 9' }), 'Bo Ellery moved to Mon 9 (Stagehand)')
  const { subject, text } = buildDigestEmail({ to: 'pm@x.test', pmName: 'Sam', showName: 'Northwind', date: 'Sep 7', link: 'https://crewtracker.app/dashboard/shows/1',
    lines: [{ time: '2:14 pm', text: 'Alex Reyes booked as A1, Tue 8 – Thu 10', status: 'waiting on reply' }] })
  check('digest subject', subject, 'Northwind: today\'s crew changes (Sep 7)')
  check('line carries current status', text.includes('2:14 pm  Alex Reyes booked as A1, Tue 8 – Thu 10 — waiting on reply'), true)
}
```

- [ ] **Step 2: Run** → fails.

- [ ] **Step 3: Implement.**
  - `lib/staffingEvents.ts`: one exported function that inserts into `staffing_events` through whatever client it is handed (the caller's browser client on the tracker, `admin` in routes); catches and `console.error`s.
  - `lib/digestEmail.ts`: `describeEvent` (booked/accepted/declined/released/days_changed/moved/extended → the sentences above; `extended` → `${name} extended to ${days} (${role})`; `days_changed` → `${name}'s days changed to ${days} (${role})`; `released` → `${name} released from ${role}${days ? `, ${days}` : ''}`), `buildDigestEmail` (text lines `${time}  ${text}${status ? ` — ${status}` : ''}`; html a table), `sendDigestEmail`.
  - `app/api/digest/route.ts` (GET, `CRON_SECRET` check copied from keepalive): service role; shows with `ready_email_sent_at not null and pm_profile_id not null and pm_accepted_at not null and finalized_at is null and archived is not true`; for each, unsent events; skip shows with none; look up the PM's email and name; compute each line's current status from the show's live timecards for `crew_member_id` (or by `crew_member_name` when null); the `time` in the show's timezone via `Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })`; the `date` header is today in the show's timezone (`todayInZone`); send; `update staffing_events set sent_at = now() where id in (…)`. Returns `{ ok, shows: n, emails: m }`. Failures per show are logged and skipped, never fail the run.
  - `vercel.json`: add `{ "path": "/api/digest", "schedule": "30 23 * * *" }` (Hobby allows two daily crons).
  - `proxy.ts`: `path.startsWith("/api/digest") ||` beside the keepalive line.
  - Writers (each a one-line `logStaffingEvent` after a successful write; `days` from `compressDays` where dates are at hand, else null):
    - `app/api/bookings/respond`: `accepted` / `declined` (admin client; name from the crew row; role from the first timecard).
    - `FillPositionPicker.book()`: `booked`, days = `compressDays([date, ...extra.map(s => s.date)])`; needs `showId` — read it once in the mount effect from `rooms.show_id` for `roomId`.
    - `PositionDefsSection.confirmMove()`: `moved` (days = the target date); `release()`: `released`.
    - `RoomActionsMenu.removeCrew()`: `released` — needs the show id: `RoomActionsMenu` receives `showId` from both trackers (add the prop; the tracker page has `show.id`, `MobileRoomTracker` has it in props).
    - `StaffRoomModal` after the insert: one `booked` per person with `compressDays(dates)`; it already knows `dayRow.show_id`.

- [ ] **Step 4: Prove on dev.** With a ready-emailed throwaway show (Task 4's fixture): book somebody through the tracker's Fill → a `staffing_events` row; `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/digest` (no secret set locally → no header needed) → `{ ok, shows: 1, emails: 1 }`, the row's `sent_at` set; run again → `emails: 0`. A show without `ready_email_sent_at` produces nothing however many events it has.

- [ ] **Step 5: Build, commit.**

```bash
npm run build && rm -rf .next && npm run test:schedule
git add lib/staffingEvents.ts lib/digestEmail.ts app/api/digest/route.ts vercel.json proxy.ts app/api/bookings/respond/route.ts components/FillPositionPicker.tsx components/PositionDefsSection.tsx components/RoomActionsMenu.tsx components/StaffRoomModal.tsx components/MobileRoomTracker.tsx "app/dashboard/shows/[id]/page.tsx" scripts/test/schedule.mts scripts/test/preview-show-emails.mts
git commit -m "Staffing events and the evening digest: one email per show to an accepted PM, each line with its current status.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 6: Add Day extends all-day people; crew change notices

**Files:**
- Create: `lib/daysChangedEmail.ts`, `app/api/crew/days-changed/route.ts`, `components/CrewChangeNotice.tsx`
- Modify: `components/AddDayButton.tsx`, `components/PositionDefsSection.tsx`, `components/RoomActionsMenu.tsx`, `scripts/test/schedule.mts`, `scripts/test/preview-show-emails.mts`

**Interfaces:**
- Produces: `POST /api/crew/days-changed` body `{ showId, crewMemberIds: string[] }` → `{ ok, sent: number, skipped: string[] }` (session; scheduling module gated; show and crew read through the caller; `crew_members.email` required, else skipped by name). `buildDaysChangedEmail({ to, crewName, showName, orgName, venue, days: EngagementDay[], link? })` using `describeDayLines` from `lib/bookingEmail.ts` for the list; subject `${orgName}: your days on ${showName} changed`. `CrewChangeNotice({ showId, people: { id: string; name: string }[], onDone })` — a `border-l-[3px] border-accent` bar: `Tell the ${n} crew whose days changed?` + names + **Send** / **Not now**.
- `AddDayButton` gains `hasDefs: boolean` (the show has any `position_defs`); with defs the dialog offers a `Toggle` "Extend everyone on all-day positions to the new day" (on) instead of the copy-crew choice; after `add_show_day(p_copy_crew=false)` → `sync_position_slots` → if on, `extend_all_day_positions(showId, work_day_id)`, which returns the people it extended, so the client logs one `extended` event per row and offers the notice with their names.

- [ ] **Step 1: Failing test** in `schedule.mts`:

```ts
console.log('\n--- days changed email ---')
{
  const { subject, text } = buildDaysChangedEmail({ to: 'a@x.test', crewName: 'Alex Reyes', showName: 'Northwind', orgName: 'Wood & Waves', venue: 'Moscone West',
    days: [{ date: '2026-09-08', isTravelDay: false, travelIn: true, travelOut: false, activities: ['load_in'] }, { date: '2026-09-09', isTravelDay: false, travelIn: false, travelOut: false, activities: ['show'] }] })
  check('subject', subject, 'Wood & Waves: your days on Northwind changed')
  check('lists the new days with what each is', text.includes('Tue, Sep 8') && text.includes('Load-in') && text.includes('Wed, Sep 9'), true)
}
```

- [ ] **Step 2: Run** → fails.

- [ ] **Step 3: Implement** `lib/daysChangedEmail.ts` (`buildDaysChangedEmail`, `sendDaysChangedEmail`; body: `Hi ${first},` / `Your days on ${showName}${venue ? ` (${venue})` : ''} have changed. Here is your current schedule:` / one line per `describeDayLines` entry `${l.date}${l.production ? ` · ${l.production}` : ''}${l.you ? ` · ${l.you}` : ''}` / `No days` when empty (they were released) / `Questions? Reply to whoever booked you.` / sign-off; no link — a crew member has no login) and the route (reads `shows` + `crew_members` through the caller; builds each person's `EngagementDay[]` from their live timecards on the show the way `app/api/bookings/send` does; one email each; returns counts).

- [ ] **Step 4: The notice component and its three homes.** `components/CrewChangeNotice.tsx` posts to the route, shows `Sent to N.` (+ `Couldn't reach: …` for skipped) then calls `onDone`. Wire it: `PositionDefsSection` keeps `changed: {id,name}[]` state, appended by `confirmMove` and `release` (the flag carries `crew_member_id` since 0035; add it to the Edit Show page's `position_slot_flags` select and to `SlotFlag`); `RoomActionsMenu.removeCrew` (it has `crewMemberId`); `AddDayButton` after an extension (the RPC's returned rows). Each renders `<CrewChangeNotice>` when `changed.length > 0`.

- [ ] **Step 5: Prove on dev.** Throwaway show, all-day A1 booked on the last day: Add Day with the toggle on → the person appears on the new day, pencilled, and the notice offers `Tell the 1 crew…` → Send → `sent: 1` (the seeded crew have emails). Release a flagged booking → the notice appears → Not now → gone. Remove somebody from a room → notice → Send.

- [ ] **Step 6: Build, commit.**

```bash
npm run build && rm -rf .next && npm test
git add lib/daysChangedEmail.ts app/api/crew/days-changed/route.ts components/CrewChangeNotice.tsx components/AddDayButton.tsx components/PositionDefsSection.tsx components/RoomActionsMenu.tsx scripts/sql/migrations/0035_scheduling_queue.sql scripts/test/rls.mts scripts/test/schedule.mts scripts/test/preview-show-emails.mts "app/dashboard/shows/[id]/edit/page.tsx"
git commit -m "Add Day extends all-day people; crew change notices offered after a move, a release, a removal or an extension.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 7: Docs, STOP for Dan, cutover on his word

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md.** Under the piece-B section add **"The scheduling queue and the PM emails (piece C, 2026-09-07)"**: nobody owns a sent show; the permission-based door and the five places it lives; `scheduler_id`/`call_approved_*` are history, written by nothing; the Needs-scheduling list; the ready email's one gate and its two callers; `staffing_events` + the digest cron (`/api/digest`, 23:30 UTC, `CRON_SECRET`); `extend_all_day_positions`; crew notices offered from three places; `preview:emails`. Migrations list: 0035 (dev-only until cutover; WRITES existing rows: the backfill). Schema: `staffing_events`, the new `shows` columns. File map: the new files; remove `HandoffToSchedulerButton`/`approve-call`. Test count. The "Already built" handoff bullet reworded to the queue.

- [ ] **Step 2: Commit docs, push, report to Dan** with: the preview URL; what to try (send a show, see it as a scheduler, the Needs-scheduling list, fill everything and confirm the last one as the PM to get the ready email, make a change and hit `/api/digest` by hand, Add Day with the extension, a release with the notice); the cutover steps (backup → 0035 `--prod` → `db:grants` → `db:schema` → merge; 0035 backfills `sent_to_scheduling_at` from `call_approved_at`, verify with a read-only count after); and the push notification after the idle wait. **STOP. Do not cut over without Dan's word.**

---

## Self-review

- **Spec coverage.** Send to everyone with the permission → T2. Schedulers see only sent shows (all five places) → T1. Needs-scheduling list → T3. Ready email, only to an accepted PM, held until acceptance, idempotent → T4. Evening digest after the ready email, current status per line, cron → T5. Day-change flags on Edit Show (exists from B) and on the queue row → T3. All-day extension on Add Day → T1 + T6. Crew change notices, offered from the change → T6. `scheduler_id` stops being written → T2.
- **Placeholders.** None: every step carries code or an exact edit. T4's route call is one line each; T6's view change is named precisely (`t.crew_member_id` in `position_slot_flags`, done in 0035 while it is unapplied to production).
- **Types.** `QueueSummary` keys match the test; `compressDays` tokens match `describeDefDays`'s style; `extend_all_day_positions` returns a table from Task 1 and its test counts rows over it; `SlotFlag` gains `crew_member_id` in Task 6 to match the 0035 view.
