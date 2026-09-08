# The Scheduling screen — implementation plan

> **DONE and SHIPPED 2026-09-08.** All six tasks executed inline, no subagents. On
> crewtracker.app since the 16fe900 merge. The suite finished at 533 assertions, not the 475
> this plan predicted, because the day's work went well past it: the grid was rebuilt as position
> ROWS after Dan saw names shuffling between columns, the day header and position column were
> pinned, Remove joined the status chip, the PM's answer became a chip of its own, and both
> emails gained real Accept and Decline buttons. Everything below is the plan as written; the
> record of what the screen actually became is in CLAUDE.md.

> **For agentic workers:** Execute this plan INLINE in the session (superpowers:executing-plans).
> **Do NOT use subagent-driven-development, do not dispatch subagents, and do not use any model
> other than the session's** — Dan's standing rule (memory `no-subagents-without-approval`).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One screen per show — rooms down, days across — where a scheduler does every
scheduling job (fill, ask, record answers, sort flags, edit the positions themselves) without
opening the tracker; then scheduling comes off the tracker.

**Architecture:** A server page at `/dashboard/shows/[id]/schedule` reads the show's days, rooms,
slots, live timecards and flags in ONE round of queries, hands them to a pure model
(`lib/scheduleBoard.ts`) that lays them out as cells, and renders a client grid whose cells drop
in the components that already exist — `FillPositionPicker`, `BookingStatusChip`, the flag's
Move / Keep / Release. Above the grid: the counts and the show's scheduling actions. Below it:
`PositionDefsSection`, unchanged. No migration; no new API route; two small component changes
(a chip that behaves differently here, and the flag actions extracted so both screens share them).

**Tech Stack:** Next.js 16 App Router (server page + client grid), Supabase JS through the
caller's session (RLS is the authorization, as everywhere), Tailwind/Showbill primitives,
plain-Node tests in `scripts/test/schedule.mts`.

**Spec:** `docs/superpowers/specs/2026-09-07-scheduling-screen-design.md`

## Global Constraints

- **"Positions", never "call"** in any user-facing string. Answers are **Approved** and
  **Declined** — never "confirmed by phone", "backed out", "accepted".
- **Simplicity and less verbiage is key** (Dan). No sentence on this screen that a scheduler
  would not read twice.
- **The tracker stays simple.** Its only scheduling thing is the status chip while an answer is
  owed. Nothing added to the tracker by this plan; things are removed from it (Task 6).
- **THE ONE RULE holds: the app adds open slots freely and never removes a booked person.**
  Nothing here deletes a booking except an explicit Release.
- **No service role anywhere on this screen.** Every read and write goes through the caller's
  session so RLS decides. No cross-organization reads, ever.
- **Scheduling is a module.** The page is gated on `canUseScheduling(user)` and redirects to the
  show when it is off, exactly like `/dashboard/schedule`.
- **Open Paper:** ONE solid `BAND` per screen (the show masthead). The grid's room column and
  day header are LIGHT strips (`bg-surface-2` closed by `border-b-2 border-ink`). Sections close
  with `RULE_MAJOR`. Boxes only for form fields and true overlays.
- **Desktop-first**, usable on an iPad. Not optimised for a phone; the grid scrolls sideways.
- **Tailwind cannot see interpolated class names.** A column template whose count varies at
  runtime goes in `style={{ gridTemplateColumns: … }}`, never in a template-literal class.
- Every write is a **verified write** (`.select('id')` and check the rows), then optimistic
  paint or `router.refresh()`.
- `npm run build` must pass before any commit, checked by **exit code** (`set -o pipefail`),
  never by grepping piped output. Stop the dev server first; `rm -rf .next` after.
- Commits go to the `scheduling` branch — **preview only, crewtracker.app untouched.**

## Counting rules (settled here so no task invents its own)

The strip reads: `12 of 20 positions confirmed · 2 people waiting · 3 open · 1 to sort out`.

- **positions** = every entry on the grid: each open slot, and each booked person on each day.
  One person on four days is four positions. The word "positions" is on the line on purpose —
  Dan read a person-day count labelled "people" as a headcount once already, and said so.
- **waiting** = distinct PEOPLE with a live booking still pencilled or asked. Same unit and
  wording as the Needs-scheduling row, which Dan already accepted.
- **open** = unfilled slots. **to sort out** = flagged bookings (`position_slot_flags`).
- A person staffed by hand with no slot (StaffRoomModal, Copy Crew, Add Day) **is** an entry on
  the grid and does count. They are real bookings; leaving them off would make the screen lie
  about who is on the show, and "Ask everyone pencilled" already emails them.

## What this screen deliberately does NOT take from the tracker

- **Setting a person's travel day.** The old ⋮ → Positions panel could set Work / Travel /
  Travel + work while booking. The tracker's own flag pills keep doing that, and the tracker is
  where somebody notices travel. Recorded as a backlog line in Task 6, not rebuilt here.
- **Adding a one-off position to a single room-day.** The definitions editor covers it: a
  definition with **Custom dates** and one date ticked is exactly that, and it stays attached to
  the day grid instead of becoming an orphan the sync ignores.
- **Editing day activities.** The day header shows each day's label and tint (that is what
  explains which cells exist); changing them stays on Edit Show, one click away.

## File Structure

**Create**
- `lib/scheduleBoard.ts` — the pure model: cells from days × rooms × slots × bookings × flags,
  plus the summary and its wording. Plain module, no `'use client'`.
- `app/dashboard/shows/[id]/schedule/page.tsx` — the server page: guards, one round of queries,
  the strip, the grid, the definitions editor.
- `components/ScheduleBoard.tsx` — the client grid: header row, one row per room, cells, the
  Fill picker under a room's row, the flag actions in place.
- `components/SlotFlagActions.tsx` — Move / Keep / Release for one flagged booking, extracted
  from `PositionDefsSection` so the grid and Edit Show share one implementation.

**Modify**
- `components/BookingStatusChip.tsx` — a `context` prop: `'tracker'` (today's behaviour,
  unchanged) or `'scheduling'` (a confirmed chip renders and is tappable → Declined; a pencilled
  chip also offers Ask by email).
- `components/PositionDefsSection.tsx` — its flag row uses `SlotFlagActions`; re-exports the
  `SlotFlag` type from `lib/scheduleBoard` so `EditShowClient`'s import is untouched.
- `scripts/test/schedule.mts` — the board's tests.
- `components/NeedsSchedulingList.tsx` — rows link to the Scheduling screen.
- `app/dashboard/shows/[id]/page.tsx` — a Scheduling link in the header; open-position rows removed.
- `components/EditShowClient.tsx` — a link to the Scheduling screen in the Scheduling section.
- `components/RoomActionsMenu.tsx` — the Positions item and the modal mount removed.
- `CLAUDE.md`, the spec, `.superpowers/sdd/progress.md`.

**Delete (Task 6, only after the screen does their job)**
- `components/OpenPositionRow.tsx`, `components/CrewCallModal.tsx` — and anything they were the
  last importer of, checked with grep rather than assumed.

---

### Task 1: The board model

**Files:**
- Create: `lib/scheduleBoard.ts`
- Test: `scripts/test/schedule.mts` (new block near the scheduling-queue block)

**Interfaces:**
- Consumes: nothing. Pure.
- Produces: `buildBoard(input: BoardInput): Board`, `describeBoard(s: BoardSummary): string`,
  `cellKey(roomName, date): string`, and the types `Board`, `BoardCell`, `BoardEntry`,
  `BoardBooking`, `BoardDay`, `BoardSummary`, `SlotFlag`. Tasks 3, 4 and 5 import these.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test/schedule.mts` — import at the top with the other lib imports:

```ts
import { buildBoard, describeBoard, cellKey } from '../../lib/scheduleBoard.ts'
```

and this block after the `--- scheduling queue summary ---` block:

```ts
console.log('\n--- scheduling board ---')
{
  const days = [
    { workDayId: 'w1', date: '2026-09-08', activities: ['load_in'] },
    { workDayId: 'w2', date: '2026-09-09', activities: ['show'] },
  ]
  const rooms = [
    { id: 'r1', name: 'Ballroom', workDayId: 'w1' },
    { id: 'r2', name: 'Ballroom', workDayId: 'w2' },
    // Breakout exists on the show day only.
    { id: 'r3', name: 'Breakout', workDayId: 'w2' },
  ]
  const slots = [
    { id: 's1', roomId: 'r1', role: 'A1', sortOrder: 0 },
    { id: 's2', roomId: 'r1', role: 'Stagehand', sortOrder: 1 },
    { id: 's3', roomId: 'r2', role: 'A1', sortOrder: 0 },
    { id: 's4', roomId: 'r3', role: 'V1', sortOrder: 0 },
  ]
  const booking = (over: Record<string, unknown>) => ({
    timecardId: 't', crewMemberId: 'c1', crewMemberName: 'Alex Reyes', role: 'A1',
    status: 'pencilled' as const, roomId: 'r1', slotId: 's1', ...over,
  })
  const bookings = [
    booking({ timecardId: 't1' }),
    booking({ timecardId: 't2', roomId: 'r2', slotId: 's3', status: 'confirmed' }),
    // Hand-staffed: a live booking holding no slot at all.
    booking({ timecardId: 't3', roomId: 'r2', slotId: null, crewMemberId: 'c2', crewMemberName: 'Bo Ellery', role: 'Stagehand', status: 'pencilled' }),
  ]
  const flag = {
    slot_id: 's3', position_def_id: 'd1', room_name: 'Ballroom', date: '2026-09-09',
    role: 'A1', timecard_id: 't2', crew_member_name: 'Alex Reyes', crew_member_id: 'c1',
  }
  const board = buildBoard({ days, rooms, slots, bookings, flags: [flag] })

  check('rooms are the room NAMES, sorted', board.roomNames, ['Ballroom', 'Breakout'])
  check('a room that does not run that day has no cell room', board.cells[cellKey('Breakout', '2026-09-08')].roomId, null)
  check('and therefore no entries', board.cells[cellKey('Breakout', '2026-09-08')].entries.length, 0)
  check('a cell lists its slots in sort order',
    board.cells[cellKey('Ballroom', '2026-09-08')].entries.map(e => e.kind), ['booked', 'open'])
  check('an unfilled slot carries its role',
    (board.cells[cellKey('Ballroom', '2026-09-08')].entries[1] as any).role, 'Stagehand')
  check('a hand-staffed person with no slot still appears',
    board.cells[cellKey('Ballroom', '2026-09-09')].entries.map(e => (e as any).booking?.crewMemberName),
    ['Alex Reyes', 'Bo Ellery'])
  check('a flagged booking carries its flag',
    (board.cells[cellKey('Ballroom', '2026-09-09')].entries[0] as any).flag.slot_id, 's3')
  check('an unflagged booking carries null',
    (board.cells[cellKey('Ballroom', '2026-09-08')].entries[0] as any).flag, null)
  check('summary counts positions, not people',
    board.summary, { total: 5, confirmed: 1, open: 2, waitingPeople: 2, flags: 1 })
  check('the strip reads in one line',
    describeBoard(board.summary), '1 of 5 positions confirmed · 2 people waiting · 2 open · 1 to sort out')
  check('nothing to schedule says so', describeBoard({ total: 0, confirmed: 0, open: 0, waitingPeople: 0, flags: 0 }), 'Nothing to schedule yet')
  check('a full show reads clean', describeBoard({ total: 4, confirmed: 4, open: 0, waitingPeople: 0, flags: 0 }), '4 of 4 positions confirmed')

  // One person over four days is ONE person waiting, four positions.
  const wide = buildBoard({
    days, rooms, slots: [],
    bookings: [
      booking({ timecardId: 'x1', slotId: null, roomId: 'r1' }),
      booking({ timecardId: 'x2', slotId: null, roomId: 'r2' }),
    ],
    flags: [],
  })
  check('the same person on two days is 2 positions, 1 person waiting',
    [wide.summary.total, wide.summary.waitingPeople], [2, 1])
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:schedule
```
Expected: FAIL — `Cannot find module '../../lib/scheduleBoard.ts'`.

- [ ] **Step 3: Write `lib/scheduleBoard.ts`**

```ts
// The Scheduling screen's model: a show as rooms × days, each cell holding that
// room-day's positions and who is on them.
//
// Pure — no database, no React — so the COUNTING RULES are pinned by tests
// rather than read off the screen. They matter: a person on four days is four
// positions but one person waiting, and getting that backwards is exactly the
// misreading Dan caught on the Needs-scheduling row ("There are not 12 people
// on the Test Show 3").
//
// Rooms are per-DAY rows in the database, so a room on this grid is a room
// NAME — the same key position_defs uses. A name that does not run on a day has
// no cell to fill, which is why a cell's roomId can be null.
//
// Plain module, no 'use client'.

export type BoardStatus = 'pencilled' | 'invited' | 'confirmed'

/** A live booking. Declined rows never reach this model — they hold nothing. */
export type BoardBooking = {
  timecardId: string
  crewMemberId: string | null
  crewMemberName: string
  role: string
  status: BoardStatus
}

/** One row of the position_slot_flags view (migration 0035). */
export type SlotFlag = {
  slot_id: string
  position_def_id: string | null
  room_name: string
  date: string
  role: string
  timecard_id: string
  crew_member_name: string
  crew_member_id: string | null
}

export type BoardEntry =
  | { kind: 'open'; slotId: string; roomId: string; role: string }
  | { kind: 'booked'; slotId: string | null; roomId: string; booking: BoardBooking; flag: SlotFlag | null }

export type BoardCell = {
  /** The room's row on this day, or null when the room does not run that day. */
  roomId: string | null
  entries: BoardEntry[]
}

export type BoardDay = { workDayId: string; date: string; activities: string[] }

export type BoardSummary = {
  /** Every entry on the grid: open slots plus booked person-days. */
  total: number
  confirmed: number
  open: number
  /** Distinct PEOPLE still owing an answer, never person-days. */
  waitingPeople: number
  flags: number
}

export type Board = {
  roomNames: string[]
  days: BoardDay[]
  /** Keyed by cellKey(roomName, date). Every room × day has an entry. */
  cells: Record<string, BoardCell>
  summary: BoardSummary
}

export type BoardInput = {
  days: BoardDay[]
  rooms: { id: string; name: string; workDayId: string }[]
  slots: { id: string; roomId: string; role: string; sortOrder: number }[]
  /** Every LIVE timecard on the show; `slotId` is call_position_id. */
  bookings: (BoardBooking & { roomId: string; slotId: string | null })[]
  flags: SlotFlag[]
}

export const cellKey = (roomName: string, date: string) => `${roomName}|${date}`

export function buildBoard({ days, rooms, slots, bookings, flags }: BoardInput): Board {
  const roomNames = [...new Set(rooms.map(r => r.name))].sort((a, b) => a.localeCompare(b))
  const roomIdFor = new Map(rooms.map(r => [`${r.name}|${r.workDayId}`, r.id]))
  const flagBySlot = new Map(flags.map(f => [f.slot_id, f]))

  const slotIds = new Set(slots.map(s => s.id))
  const bySlot = new Map<string, BoardInput['bookings'][number]>()
  for (const b of bookings) if (b.slotId && slotIds.has(b.slotId)) bySlot.set(b.slotId, b)
  // Hand-staffed, or holding a slot that no longer exists: still on the show,
  // so still on the grid. Nothing here is allowed to make a booking invisible.
  const extras = bookings.filter(b => !b.slotId || !slotIds.has(b.slotId))

  const slotsByRoom = new Map<string, BoardInput['slots']>()
  for (const s of slots) slotsByRoom.set(s.roomId, [...(slotsByRoom.get(s.roomId) ?? []), s])

  const cells: Record<string, BoardCell> = {}
  for (const name of roomNames) {
    for (const day of days) {
      const roomId = roomIdFor.get(`${name}|${day.workDayId}`) ?? null
      const entries: BoardEntry[] = []
      if (roomId) {
        const mine = [...(slotsByRoom.get(roomId) ?? [])]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        for (const s of mine) {
          const b = bySlot.get(s.id)
          entries.push(b
            ? { kind: 'booked', slotId: s.id, roomId, booking: b, flag: flagBySlot.get(s.id) ?? null }
            : { kind: 'open', slotId: s.id, roomId, role: s.role })
        }
        for (const b of extras.filter(x => x.roomId === roomId).sort((a, b2) => a.crewMemberName.localeCompare(b2.crewMemberName))) {
          entries.push({ kind: 'booked', slotId: null, roomId, booking: b, flag: null })
        }
      }
      cells[cellKey(name, day.date)] = { roomId, entries }
    }
  }

  // Counted FROM THE CELLS, so the strip can never disagree with the grid.
  let total = 0, confirmed = 0, open = 0, flagCount = 0
  const waiting = new Set<string>()
  for (const cell of Object.values(cells)) {
    for (const e of cell.entries) {
      total++
      if (e.kind === 'open') { open++; continue }
      if (e.flag) flagCount++
      if (e.booking.status === 'confirmed') confirmed++
      else waiting.add(e.booking.crewMemberId ?? `name:${e.booking.crewMemberName}`)
    }
  }

  return {
    roomNames, days, cells,
    summary: { total, confirmed, open, waitingPeople: waiting.size, flags: flagCount },
  }
}

/** "12 of 20 positions confirmed · 2 people waiting · 3 open · 1 to sort out" */
export function describeBoard(s: BoardSummary): string {
  if (s.total === 0) return 'Nothing to schedule yet'
  const parts = [`${s.confirmed} of ${s.total} positions confirmed`]
  if (s.waitingPeople > 0) parts.push(`${s.waitingPeople} ${s.waitingPeople === 1 ? 'person' : 'people'} waiting`)
  if (s.open > 0) parts.push(`${s.open} open`)
  if (s.flags > 0) parts.push(`${s.flags} to sort out`)
  return parts.join(' · ')
}
```

- [ ] **Step 4: Run the tests**

```bash
npm run test:schedule
```
Expected: PASS, and the total assertion count rises by 13 (234 → 247).

- [ ] **Step 5: Commit**

```bash
git add lib/scheduleBoard.ts scripts/test/schedule.mts && git commit -m "The Scheduling screen's board model: cells from rooms x days x slots, counted once."
```

---

### Task 2: The chip behaves differently where a scheduler works

**Files:**
- Modify: `components/BookingStatusChip.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BookingStatusChip` gains `context?: 'tracker' | 'scheduling'` (default `'tracker'`).
  Task 4's cells pass `context="scheduling"`. The tracker's two call sites pass nothing and
  must be untouched.

Why: the spec settles it — on the tracker a confirmed row is name and role, nothing to tap; on
the Scheduling screen a confirmed chip IS tappable, because recording that somebody backed out
is a scheduling job and there has to be somewhere to do it. Asking ONE person by email also
lands here, since the ⋮ Positions panel that used to own it is being removed in Task 6.

- [ ] **Step 1: Add the prop and widen the early return**

Replace the props block and the confirmed early-return:

```tsx
export default function BookingStatusChip({
  showId, crewMemberId, crewName, status: initial, locked = false, context = 'tracker',
}: {
  showId: string
  crewMemberId: string | null
  crewName: string
  status: string | null | undefined
  locked?: boolean
  /** 'tracker' hides a confirmed chip entirely; 'scheduling' shows it and lets
   *  it be tapped (somebody backed out) and offers the single Ask by email. */
  context?: 'tracker' | 'scheduling'
}) {
```

```tsx
  if (!crewMemberId) return null
  // On the TRACKER a confirmed person shows nothing (Dan, 2026-09-07: "the
  // tracker should be simple"). On the Scheduling screen the chip stays: that
  // is where a scheduler records a person backing out.
  if (status === 'confirmed' && context === 'tracker') return null
  const tappable = !locked
```

- [ ] **Step 2: Tone the confirmed chip and add the menu items**

Replace the chip's `tone` expressions (both the button and the plain branches) with a helper
placed just above the `return`:

```tsx
  const tone = status === 'declined' ? 'danger' : status === 'confirmed' ? 'good' : 'neutral'
```

then use `tone={tone}` in both places.

Add the single ask, above `return`:

```tsx
  // Ask ONE person by email — the group ask covers a whole show, but a
  // scheduler who has just booked somebody wants to ask them now. Scheduling
  // screen only: the tracker's menu stays Approved / Declined.
  async function ask() {
    const body = await post('/api/bookings/send', { showId, crewMemberId })
    if (!body) return
    setStatus('invited')
    setOpen(false)
    setNote(body.emailed ? `Asked ${crewName.split(' ')[0]} by email.` : (body.warning || 'No email on file for them.'))
    router.refresh()
  }
```

and inside the menu, after the Declined item:

```tsx
          {context === 'scheduling' && status === 'pencilled' && (
            <button type="button" role="menuitem" disabled={busy} onClick={ask}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
              Ask by email
            </button>
          )}
```

Also hide **Approved** when they are already confirmed (nothing to record):

```tsx
          {status !== 'confirmed' && (
            <button type="button" role="menuitem" disabled={busy} onClick={() => record('confirmed')}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
              Approved
            </button>
          )}
```

- [ ] **Step 3: Prove the tracker is unchanged**

```bash
grep -n "BookingStatusChip" components/TimecardRow.tsx components/MobileRoomTracker.tsx
```
Expected: the existing call sites, with NO `context` prop — they keep `'tracker'` by default.

```bash
npm run build; echo "build exit: $?"
```
Expected: `build exit: 0`.

- [ ] **Step 4: Commit**

```bash
git add components/BookingStatusChip.tsx && git commit -m "Booking chip: a scheduling context where a confirmed answer can still change and one person can be asked."
```

---

### Task 3: Move / Keep / Release, extracted so both screens share it

**Files:**
- Create: `components/SlotFlagActions.tsx`
- Modify: `components/PositionDefsSection.tsx`

**Interfaces:**
- Consumes: `SlotFlag` from `lib/scheduleBoard` (Task 1).
- Produces: `<SlotFlagActions showId flag locked onChanged />` where `onChanged` reports the
  person whose days changed (`{ id, name }`) so the parent can offer `CrewChangeNotice`.
  `PositionDefsSection` keeps re-exporting `type SlotFlag`, so `EditShowClient`'s import
  (`import PositionDefsSection, { type DefRow, type SlotFlag }`) keeps compiling untouched.

Why: the spec puts a flag "in place with Move / Keep / Release" inside the grid cell, and Edit
Show's list needs the identical behaviour. One implementation, two hosts.

- [ ] **Step 1: Create `components/SlotFlagActions.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import type { SlotFlag } from '@/lib/scheduleBoard'

// One booked day that no longer fits its definition, and the three human
// answers to it (piece B's rule, unchanged): MOVE them to one of the
// definition's open days, KEEP the day anyway (the slot detaches and becomes a
// one-off), or RELEASE the booking. The app never decides this itself — THE ONE
// RULE is that it adds open slots freely and never removes a booked person.
//
// Extracted from PositionDefsSection so the Scheduling screen's cells and Edit
// Show's list are the same code. The caller owns the crew change notice: both
// hosts collect the people whose days moved and offer to tell them, once.

type OpenSlot = { id: string; room_id: string; date: string; room_name: string }

function fmt(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function SlotFlagActions({
  showId, flag, locked = false, onChanged, onDone,
}: {
  showId: string
  flag: SlotFlag
  locked?: boolean
  /** Their days just changed — offer to tell them. Only people with a crew id. */
  onChanged?: (person: { id: string; name: string }) => void
  /** The flag is settled; the host may close whatever revealed these actions. */
  onDone?: () => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)
  const [openSlots, setOpenSlots] = useState<OpenSlot[]>([])
  const [target, setTarget] = useState('')

  function changed() {
    if (flag.crew_member_id) onChanged?.({ id: flag.crew_member_id, name: flag.crew_member_name })
  }

  async function startMove() {
    setError(''); setMoving(true); setOpenSlots([]); setTarget('')
    if (!flag.position_def_id) return
    // The definition's slots on other days, minus the ones somebody holds.
    const [{ data: slots }, { data: held }] = await Promise.all([
      supabase.from('crew_call_positions')
        .select('id, room_id, rooms!inner ( name, work_days!inner ( date ) )')
        .eq('position_def_id', flag.position_def_id),
      supabase.from('timecards').select('call_position_id')
        .not('call_position_id', 'is', null).neq('booking_status', 'declined'),
    ])
    const taken = new Set((held ?? []).map((t: any) => t.call_position_id))
    const open = (slots ?? []).filter((s: any) => !taken.has(s.id)).map((s: any) => {
      const room = Array.isArray(s.rooms) ? s.rooms[0] : s.rooms
      const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
      return { id: s.id, room_id: s.room_id, date: wd?.date ?? '', room_name: room?.name ?? '' }
    }).sort((a: OpenSlot, b: OpenSlot) => a.date.localeCompare(b.date))
    setOpenSlots(open)
    setTarget(open[0]?.id ?? '')
  }

  async function confirmMove() {
    const slot = openSlots.find(s => s.id === target)
    if (!slot) return
    setBusy(true); setError('')
    const { data, error: e } = await supabase.from('timecards')
      .update({ room_id: slot.room_id, call_position_id: slot.id }).eq('id', flag.timecard_id).select('id')
    if (e || !data?.length) { setBusy(false); setError(e?.message ?? 'That did not move.'); return }
    await logStaffingEvent(supabase, {
      showId, kind: 'moved', crewMemberId: flag.crew_member_id,
      crewMemberName: flag.crew_member_name, role: flag.role, days: compressDays([slot.date]),
    })
    changed()
    setMoving(false)
    await supabase.rpc('sync_position_slots', { p_show_id: showId })
    setBusy(false)
    onDone?.()
    router.refresh()
  }

  async function keep() {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.from('crew_call_positions')
      .update({ position_def_id: null }).eq('id', flag.slot_id).select('id')
    setBusy(false)
    if (e || !data?.length) { setError(e?.message ?? 'That did not save.'); return }
    onDone?.()
    router.refresh()
  }

  async function release() {
    if (!confirm(`Release ${flag.crew_member_name} from ${flag.role} on ${fmt(flag.date)}? Their booking that day is removed.`)) return
    setBusy(true); setError('')
    const { data, error: e } = await supabase.from('timecards').delete().eq('id', flag.timecard_id).select('id')
    if (e || !data?.length) { setBusy(false); setError(e?.message ?? 'That did not release.'); return }
    await logStaffingEvent(supabase, {
      showId, kind: 'released', crewMemberId: flag.crew_member_id,
      crewMemberName: flag.crew_member_name, role: flag.role, days: compressDays([flag.date]),
    })
    changed()
    await supabase.rpc('sync_position_slots', { p_show_id: showId })
    setBusy(false)
    onDone?.()
    router.refresh()
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="ghost" disabled={busy || locked || !flag.position_def_id} onClick={startMove}>Move</Button>
      <Button size="sm" variant="ghost" disabled={busy || locked} onClick={keep}>Keep</Button>
      <Button size="sm" variant="danger" disabled={busy || locked} onClick={release}>Release</Button>
      {moving && (
        <span className="flex w-full items-center gap-2 pl-1">
          {openSlots.length === 0 ? (
            <span className="text-xs text-muted">No open day for this position right now.</span>
          ) : (
            <>
              <Select ariaLabel="Move to" size="sm" value={target} onChange={setTarget}
                options={openSlots.map(s => ({ value: s.id, label: `${fmt(s.date)} · ${s.room_name}` }))} />
              <Button size="sm" disabled={busy} onClick={confirmMove}>Move here</Button>
            </>
          )}
          <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setMoving(false)}>Cancel</button>
        </span>
      )}
      {error && <span className="w-full text-xs text-danger">{error}</span>}
    </span>
  )
}
```

- [ ] **Step 2: Point `PositionDefsSection` at it**

In `components/PositionDefsSection.tsx`:

1. Replace its own `SlotFlag` type declaration with a re-export, and drop the now-unused
   imports (`logStaffingEvent`, `compressDays`, `Select`) if nothing else in the file uses them:

```tsx
import type { SlotFlag } from '@/lib/scheduleBoard'
import SlotFlagActions from '@/components/SlotFlagActions'
export type { SlotFlag }
```

2. Delete `startMove`, `confirmMove`, `keep`, `release`, and the `moving` / `openSlots` /
   `target` state — all of it now lives in `SlotFlagActions`.

3. Replace the flag row's action cluster and the inline move UI with:

```tsx
                <span className="ml-auto">
                  <SlotFlagActions
                    showId={showId}
                    flag={f}
                    locked={locked || busy}
                    onChanged={p => setChanged(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p])}
                  />
                </span>
```

Keep everything else — the definitions editor, the `changed` state, `CrewChangeNotice`.

- [ ] **Step 3: Verify Edit Show still behaves and compiles**

```bash
npm run build; echo "build exit: $?"
```
Expected: `build exit: 0`.

```bash
grep -rn "from '@/components/PositionDefsSection'" components app
```
Expected: only `components/EditShowClient.tsx`, importing `DefRow` and `SlotFlag` as before.

- [ ] **Step 4: Commit**

```bash
git add components/SlotFlagActions.tsx components/PositionDefsSection.tsx && git commit -m "Extract Move / Keep / Release so Edit Show and the Scheduling screen share one implementation."
```

---

### Task 4: The Scheduling screen

**Files:**
- Create: `app/dashboard/shows/[id]/schedule/page.tsx`
- Create: `components/ScheduleBoard.tsx`

**Interfaces:**
- Consumes: `buildBoard` / `describeBoard` / `cellKey` / `Board` (Task 1), `SlotFlagActions`
  (Task 3), `BookingStatusChip` with `context="scheduling"` (Task 2), and the untouched
  `FillPositionPicker`, `PositionDefsSection`, `SendToSchedulingButton`, `AskPencilledButton`,
  `CrewChangeNotice`, `summarizeCall` / `describeCallSize`.
- Produces: the route `/dashboard/shows/[id]/schedule`. Task 5 links to it.

- [ ] **Step 1: Write the page**

`app/dashboard/shows/[id]/schedule/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling, isPmOnShow } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'
import { BAND } from '@/lib/panel'
import ScheduleBoard from '@/components/ScheduleBoard'
import PositionDefsSection from '@/components/PositionDefsSection'
import SendToSchedulingButton from '@/components/SendToSchedulingButton'
import AskPencilledButton from '@/components/AskPencilledButton'
import { buildBoard, describeBoard, type BoardBooking, type SlotFlag } from '@/lib/scheduleBoard'
import { summarizeCall, describeCallSize } from '@/lib/crewCall'

// The Scheduling screen (2026-09-07 spec). Weeks before the show, at a desk:
// positions, filling, asking, answers, flags — everything the tracker's room ⋮
// was carrying for a person who is not the PM and not on site.
//
// Dan: "Too much lives there. Maybe scheduling is separate from the tracker."
// So this screen owns the whole job, and the tracker keeps ONE scheduling
// thing: the status chip, while an answer is owed.
//
// Everything reads through the caller's session. A scheduler reaches a SENT
// show through the queue door in the shows policy (migration 0035), which also
// makes isPmOnShow true for them — so this page needs no permission logic of
// its own beyond the module gate.

export default async function ShowSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [user, { data: show }, { data: workDays }] = await Promise.all([
    getCurrentUser(),
    supabase.from('shows').select('*').eq('id', id).single(),
    supabase.from('work_days').select('id, date, day_number, activities').eq('show_id', id).order('day_number'),
  ])
  if (!user) redirect('/login')
  if (!show) notFound()
  // The module gate, not a permission: a company without scheduling has no
  // such screen, and a bookmark must not be the way around that.
  if (!canUseScheduling(user)) redirect(`/dashboard/shows/${id}`)
  if (!(await isPmOnShow(supabase, id))) redirect(`/dashboard/shows/${id}`)

  const days = (workDays ?? []).map(d => ({ workDayId: d.id, date: d.date, activities: d.activities ?? [] }))
  const workDayIds = days.map(d => d.workDayId)

  const { data: roomRows } = workDayIds.length
    ? await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', workDayIds).order('created_at')
    : { data: [] as any[] }
  const rooms = (roomRows ?? []).map((r: any) => ({ id: r.id, name: r.name, workDayId: r.work_day_id }))
  const roomIds = rooms.map(r => r.id)

  // The screen's one query shape: this show's slots, its live bookings, its
  // flags, its definitions and the role list — none depends on another.
  const [
    { data: slotRows }, { data: bookingRows }, { data: flagRows }, { data: defRows }, { data: roleRows }, { data: pmProfile },
  ] = await Promise.all([
    roomIds.length
      ? supabase.from('crew_call_positions').select('id, room_id, role, sort_order').in('room_id', roomIds).order('sort_order')
      : Promise.resolve({ data: [] as any[] }),
    // A declined person holds nothing, so they are filtered in SQL — the same
    // rule lib/timecardFields.ts applies everywhere else.
    supabase.from('timecards')
      .select('id, room_id, call_position_id, crew_member_id, crew_member_name, role, booking_status')
      .eq('show_id', id).neq('booking_status', 'declined'),
    supabase.from('position_slot_flags')
      .select('slot_id, position_def_id, room_name, date, role, timecard_id, crew_member_name, crew_member_id')
      .eq('show_id', id).order('date'),
    supabase.from('position_defs').select('id, room_name, role, count, day_kind, custom_dates, sort_order').eq('show_id', id).order('sort_order'),
    supabase.from('av_roles').select('name').eq('organization_id', user.organizationId!).order('name'),
    show.pm_profile_id
      ? supabase.from('profiles').select('full_name, email').eq('id', show.pm_profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const board = buildBoard({
    days,
    rooms,
    slots: (slotRows ?? []).map((s: any) => ({ id: s.id, roomId: s.room_id, role: s.role, sortOrder: s.sort_order })),
    bookings: (bookingRows ?? []).map((t: any): BoardBooking & { roomId: string; slotId: string | null } => ({
      timecardId: t.id,
      roomId: t.room_id,
      slotId: t.call_position_id ?? null,
      crewMemberId: t.crew_member_id ?? null,
      crewMemberName: t.crew_member_name ?? 'Unnamed',
      role: t.role ?? '',
      status: (t.booking_status ?? 'pencilled') as any,
    })),
    flags: (flagRows ?? []) as SlotFlag[],
  })

  // The send-to-scheduling copy counts people per day, never position rows.
  const dateByRoomId = new Map(rooms.map(r => [r.id, days.find(d => d.workDayId === r.workDayId)?.date ?? '']))
  const callSummary = summarizeCall((slotRows ?? []).map((s: any) => ({ date: dateByRoomId.get(s.room_id) ?? '' })).filter(r => r.date))

  const pmName = ((pmProfile as any)?.full_name || (pmProfile as any)?.email || null) as string | null
  const locked = !!show.finalized_at
  const dates = days.length
    ? `${new Date(days[0].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(days[days.length - 1].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : ''

  return (
    <div className="p-4 md:p-10 lg:mx-auto lg:max-w-[1500px]">
      <Link href={`/dashboard/shows/${id}`} className="text-sm text-muted hover:text-ink">← Back to the tracker</Link>

      {/* The screen's ONE solid band. Everything below is light strips and rules. */}
      <div className={`${BAND} mt-2 flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold uppercase tracking-wide">{show.name}</h1>
          <p className="truncate text-xs opacity-80">
            Scheduling{dates ? ` · ${dates}` : ''}{show.venue ? ` · ${show.venue}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`/dashboard/shows/${id}/edit`}><Button variant="ghost" size="sm">Edit Show</Button></Link>
        </div>
      </div>

      {/* The strip: where the show stands, and the things you do to the whole
          show. One line of counts, then the actions on the same rule. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line py-3">
        <p className="text-sm font-semibold text-ink">{describeBoard(board.summary)}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {pmName ? (
            <span className="flex items-center gap-1.5">
              PM: <span className="text-ink">{pmName}</span>
              {show.pm_accepted_at ? <Chip tone="good">Accepted</Chip> : <Chip tone="ot">Not accepted yet</Chip>}
            </span>
          ) : (
            <span>No PM yet</span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {show.sent_to_scheduling_at && <AskPencilledButton showId={id} />}
          <SendToSchedulingButton
            showId={id}
            sentAt={show.sent_to_scheduling_at ?? null}
            positionCount={callSummary.total}
            callSize={describeCallSize(callSummary)}
          />
        </div>
      </div>

      {locked && (
        <div className="mt-3 border-l-[3px] border-danger py-1 pl-3">
          <p className="text-sm font-semibold text-ink">Times locked</p>
          <p className="mt-1 text-xs text-muted">The final report has been sent, so staffing writes are refused until the show is unlocked.</p>
        </div>
      )}

      {days.length === 0 ? (
        <p className="py-8 text-sm text-muted">This show has no days yet.</p>
      ) : rooms.length === 0 ? (
        <p className="py-8 text-sm text-muted">
          No rooms yet. Add one from <Link className="text-accent hover:underline" href={`/dashboard/shows/${id}`}>the tracker</Link>, then the positions go here.
        </p>
      ) : (
        <ScheduleBoard showId={id} board={board} locked={locked} />
      )}

      {/* The positions themselves, under the grid they explain. Flags are shown
          in the CELLS on this screen, so the section's own list is empty here. */}
      <div className="mt-8">
        <PositionDefsSection
          showId={id}
          roomNames={board.roomNames}
          roles={(roleRows ?? []).map((r: any) => r.name as string)}
          days={days.map(d => ({ date: d.date, activities: d.activities }))}
          defs={(defRows ?? []) as any[]}
          flags={[]}
          locked={locked}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the grid**

`components/ScheduleBoard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'
import BookingStatusChip from '@/components/BookingStatusChip'
import FillPositionPicker from '@/components/FillPositionPicker'
import SlotFlagActions from '@/components/SlotFlagActions'
import CrewChangeNotice from '@/components/CrewChangeNotice'
import { dayLabel, dayActivitiesBgClass } from '@/lib/dayActivities'
import { cellKey, type Board, type BoardEntry } from '@/lib/scheduleBoard'

// Rooms down the side, days across the top, every cell that room-day's
// positions — the same shape as New Show's grid, which is how this show was
// built in the first place.
//
// Tap OPEN and the Fill picker opens in a full-width row under that room,
// never in a dialog over the cell: an editor that covers what you are editing
// is the pattern this redesign removed. Tap a CHIP and the answer menu opens in
// place. A flagged booking says so and opens Move / Keep / Release in the cell.
//
// The column template is an inline style on purpose: the day count varies at
// runtime and Tailwind only generates classes it can SEE in the source (the
// same trap punchGridCols avoids with literal class names).

function dayHead(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function ScheduleBoard({
  showId, board, locked = false,
}: {
  showId: string
  board: Board
  locked?: boolean
}) {
  const router = useRouter()
  const [picker, setPicker] = useState<{ slotId: string; roomId: string; role: string; date: string; roomName: string } | null>(null)
  const [openFlag, setOpenFlag] = useState<string | null>(null)
  const [changed, setChanged] = useState<{ id: string; name: string }[]>([])

  const cols = { gridTemplateColumns: `minmax(132px, 170px) repeat(${board.days.length}, minmax(148px, 1fr))` }

  function entryNode(e: BoardEntry, roomName: string, date: string) {
    if (e.kind === 'open') {
      return (
        <button
          key={e.slotId}
          type="button"
          disabled={locked}
          onClick={() => setPicker(p => p?.slotId === e.slotId ? null : { slotId: e.slotId, roomId: e.roomId, role: e.role, date, roomName })}
          title={locked ? 'Times are locked — the final report has been sent.' : `Fill ${e.role}`}
          className={cn(
            'block w-full truncate rounded-field border border-dashed border-accent px-2 py-1 text-left text-xs font-semibold text-accent hover:bg-accent-wash disabled:opacity-40',
            picker?.slotId === e.slotId && 'bg-accent-wash',
          )}
        >
          Open · {e.role}
        </button>
      )
    }
    const b = e.booking
    return (
      <div key={e.booking.timecardId} className="min-w-0">
        <div className="truncate text-sm text-ink">{b.crewMemberName}</div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="truncate text-[11px] text-muted">{b.role || 'Crew'}</span>
          <BookingStatusChip
            context="scheduling"
            showId={showId}
            crewMemberId={b.crewMemberId}
            crewName={b.crewMemberName}
            status={b.status}
            locked={locked}
          />
        </div>
        {e.flag && (
          <div className="mt-1">
            <button type="button" onClick={() => setOpenFlag(f => f === e.flag!.slot_id ? null : e.flag!.slot_id)}
              className="text-[11px] font-semibold text-ot hover:underline">
              Day no longer fits ▾
            </button>
            {openFlag === e.flag.slot_id && (
              <div className="mt-1">
                <SlotFlagActions
                  showId={showId}
                  flag={e.flag}
                  locked={locked}
                  onChanged={p => setChanged(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p])}
                  onDone={() => setOpenFlag(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Day header — a LIGHT strip, because the show masthead above is the
              screen's one solid band. Each day carries its activities label:
              that is what explains which cells exist at all. */}
          <div style={cols} className="grid gap-px border-b-2 border-ink bg-surface-2">
            <div className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Room</div>
            {board.days.map(d => (
              <div key={d.date} className="px-3 py-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-ink">{dayHead(d.date)}</div>
                {dayLabel(d.activities) && (
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase text-muted">
                    <span className={cn('h-2 w-2 shrink-0', dayActivitiesBgClass(d.activities) ?? 'bg-line')} />
                    <span className="truncate">{dayLabel(d.activities)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {board.roomNames.map(roomName => (
            <div key={roomName} className="border-b border-line last:border-b-0">
              <div style={cols} className="grid gap-px">
                <div className="bg-surface-2 px-3 py-3 font-display text-[12px] font-semibold uppercase tracking-[0.08em] text-ink">
                  {roomName}
                </div>
                {board.days.map(d => {
                  const cell = board.cells[cellKey(roomName, d.date)]
                  return (
                    <div key={d.date} className="flex min-w-0 flex-col gap-2 px-3 py-3">
                      {!cell?.roomId ? (
                        <span className="text-xs text-muted">—</span>
                      ) : cell.entries.length === 0 ? (
                        <span className="text-xs text-muted">No positions</span>
                      ) : (
                        cell.entries.map(e => entryNode(e, roomName, d.date))
                      )}
                    </div>
                  )
                })}
              </div>

              {/* The picker for THIS room, full width under its row. */}
              {picker?.roomName === roomName && (
                <div className="border-t border-line bg-surface-2/40 px-3 py-3">
                  <p className="mb-2 text-xs text-muted">
                    {roomName} · {dayHead(picker.date)}
                  </p>
                  <FillPositionPicker
                    positionId={picker.slotId}
                    positionRole={picker.role}
                    roomId={picker.roomId}
                    date={picker.date}
                    onCancel={() => setPicker(null)}
                    onFilled={() => { setPicker(null); router.refresh() }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {changed.length > 0 && (
        <div className="mt-4">
          <CrewChangeNotice showId={showId} people={changed} onDone={() => setChanged([])} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build**

```bash
npm run build; echo "build exit: $?"
```
Expected: `build exit: 0`. Fix any type error before moving on (the likely one is
`FillPositionPicker`'s prop names — they are `positionId`, `positionRole`, `roomId`, `date`,
`onFilled`, `onCancel`).

- [ ] **Step 4: Prove it on dev**

Start the dev server, sign in with the dev login, and open the Scheduling screen for a show with
at least two rooms and several days:

```bash
npm run dev
```

Then, signed in, walk the screen and confirm each of these — this is the spec's proof list:
1. The grid shows every room name down the side and every day across, and a day where a room
   does not run reads `—`.
2. Tapping **Open** opens the Fill picker under that room; booking somebody fills the cell after
   the refresh, and the picker's day checklist appears for a definition-backed slot.
3. Tapping a **pencilled** chip offers Approved / Declined / Ask by email; tapping a
   **confirmed** chip offers Declined.
4. Retag a day on Edit Show so a booking no longer fits, come back: the cell says
   **Day no longer fits** and Move / Keep / Release work in place.
5. The strip's counts match what is on the grid, and **Ask everyone pencilled** and
   **Take back** both work from here.

- [ ] **Step 5: Commit**

```bash
git add "app/dashboard/shows/[id]/schedule/page.tsx" components/ScheduleBoard.tsx && git commit -m "The Scheduling screen: rooms down, days across, every cell a position with its answer."
```

---

### Task 5: Every way in

**Files:**
- Modify: `app/dashboard/shows/[id]/page.tsx` (desktop header)
- Modify: `components/EditShowClient.tsx` (Scheduling section)
- Modify: `components/NeedsSchedulingList.tsx` (queue rows)

**Interfaces:**
- Consumes: the route from Task 4. Produces: nothing new.

Why: a scheduler should never have to open a tracker (spec), so the queue row is the important
one — the other two are for the person who built the show.

- [ ] **Step 1: The tracker header**

In `app/dashboard/shows/[id]/page.tsx`, in the desktop header's action cluster, before Edit Show:

```tsx
            {schedulingOn && (
              <Link href={`/dashboard/shows/${id}/schedule`}>
                <Button variant="ghost" size="sm">Scheduling</Button>
              </Link>
            )}
```

The phone tracker deliberately gets no third header icon: this screen is desktop-first, and the
phone header already carries show info and report.

- [ ] **Step 2: Edit Show**

In `components/EditShowClient.tsx`, inside the `{scheduling && (…)}` section, under the
send button:

```tsx
          <p className="mt-3 text-xs text-muted">
            <a className="font-semibold text-accent hover:underline" href={`/dashboard/shows/${show.id}/schedule`}>
              Open the Scheduling screen
            </a>{' '}
            to fill positions and record answers.
          </p>
```

- [ ] **Step 3: The queue row**

In `components/NeedsSchedulingList.tsx`, change the row link:

```tsx
            <Link href={`/dashboard/shows/${row.id}/schedule`} className="min-w-0 transition-colors hover:text-accent">
```

- [ ] **Step 4: Build and check the three links**

```bash
npm run build; echo "build exit: $?"
```
Expected: `build exit: 0`. Then on dev: the tracker header shows **Scheduling**, a
Needs-scheduling row opens the new screen, and Edit Show's Scheduling section links to it.

- [ ] **Step 5: Commit**

```bash
git add "app/dashboard/shows/[id]/page.tsx" components/EditShowClient.tsx components/NeedsSchedulingList.tsx && git commit -m "Ways in to the Scheduling screen: the tracker header, Edit Show, and every queue row."
```

---

### Task 6: Scheduling comes off the tracker

**Files:**
- Modify: `app/dashboard/shows/[id]/page.tsx` (open-position rows and their query)
- Modify: `components/RoomActionsMenu.tsx` (Positions item, modal mount, `schedulingEnabled` prop)
- Modify: `components/MobileRoomTracker.tsx` (stop passing `schedulingEnabled` to the menu)
- Delete: `components/OpenPositionRow.tsx`, `components/CrewCallModal.tsx` (after a grep proves
  nothing else imports them)
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-07-scheduling-screen-design.md`

Do this LAST and only after Task 4's proof list passes: until the new screen does these jobs,
removing them takes the ability away.

- [ ] **Step 1: Remove the open-position rows from the tracker page**

Delete the `OpenPositionRow` import, the `openPositionRows` query, the `openByRoom` loop, and
the render block inside `RULE_MAJOR`. Leave `schedulingOn` alone — the status chip and the room
band's "2 of 3 confirmed" still use it.

- [ ] **Step 2: Remove the Positions panel from the room menu**

In `components/RoomActionsMenu.tsx`: delete the `CrewCallModal` import, the `<CrewCallModal … />`
mount, the `callOpen` state, the `Positions` menu item, and the `schedulingEnabled` prop with its
doc comment. Then remove `schedulingEnabled={…}` from the three `RoomActionsMenu` call sites (one
in the tracker page, two in `MobileRoomTracker`). `MobileRoomTracker` keeps its own
`schedulingEnabled` prop — the confirmed count on the band still reads it.

- [ ] **Step 3: Delete what nothing imports any more**

```bash
grep -rn "OpenPositionRow\|CrewCallModal" app components lib scripts
```
Expected: no hits. Then:

```bash
git rm components/OpenPositionRow.tsx components/CrewCallModal.tsx
```

Then check what CrewCallModal was the last importer of:

```bash
grep -rn "CallLinesEditor\|expandLines" app components lib scripts
```
Keep anything still used by `CrewCallGrid` (New Show). Delete only a file with zero hits.

- [ ] **Step 4: Build, then the full suite**

```bash
npm run build; echo "build exit: $?"
npm test
```
Expected: `build exit: 0`, and the suite green with the 13 new board assertions
(the suite finished the day at payroll 42 + schedule 288 + clock 72 + rls 131 = 533).

- [ ] **Step 5: Prove the tracker on dev**

Open the tracker for the same show: the room ⋮ holds **Edit crew / Rename room / Delete room**
only, no open-position rows appear, a pencilled crew row still shows its chip, and a confirmed
row is name and role. Punch somebody in to confirm nothing else moved.

- [ ] **Step 6: Write it down**

In `CLAUDE.md`:
- Add `components/ScheduleBoard.tsx`, `components/SlotFlagActions.tsx`, `lib/scheduleBoard.ts`
  and the `shows/[id]/schedule` route to the file-structure map; remove `OpenPositionRow` and
  `CrewCallModal` from it.
- Replace the "Tonight's tracker rule and the next piece" section with a section describing the
  built screen: what it owns, the counting rules, what left the tracker, and the two things
  deliberately not moved (travel-at-booking, day activities).
- Add two backlog lines: **setting travel days while booking** (the Positions panel used to do
  it; the tracker's flag pills are the only place now — decide whether the Scheduling cell wants
  it), and **the phone view of the Scheduling screen** (desktop-first by design; revisit if Dan
  wants it on an iPhone).

In the spec, add a line at the top: built 2026-09-08, plan
`docs/superpowers/plans/2026-09-07-scheduling-screen.md`.

- [ ] **Step 7: Commit and push**

```bash
git add -A && git commit -m "Scheduling leaves the tracker: no open rows, no Positions panel; the Scheduling screen owns it." && git push origin scheduling
```

Say the blast radius in the same sentence when asking: **push to `scheduling` — preview only,
crewtracker.app untouched, no database change anywhere.**

---

## Verification (end to end)

- `npm test` green: 533 at the end of the day. The plan expected no migration, and the screen
  itself needed none — 0038 and 0039 came out of what Dan found while testing it. So
  `rls.mts` is unchanged — the screen reads through the same policies the queue already proved.
- `npm run build` exit code 0, checked with `set -o pipefail` and `echo $?`, never a piped grep.
- On the preview (`https://crewtracker-git-scheduling-crew-tracker.vercel.app`, dev database),
  Dan's own list from the spec, on an 8-day two-room show, **without opening the tracker**:
  fill a position, approve one person, decline another, retag a day and sort the flag, ask
  everyone pencilled, take the show back from scheduling.
- The tracker afterwards: simple. Chip only while an answer is owed; ⋮ holds room jobs only.

## Blast radius

Every task is code on the `scheduling` branch — **preview only; crewtracker.app is untouched
until `scheduling` is merged to `main`, which is a separate decision.** No migration, no
`--prod`, no database change on either database.
