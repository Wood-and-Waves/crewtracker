# Schedule grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Section 4 of `docs/superpowers/specs/2026-09-06-show-access-and-schedule-design.md` — a crew × days grid on Edit Show where an admin says who works which days, in which room, with their own travel dates, in one place. Desktop first.

**Architecture:** No schema change: a cell IS a timecard row (person × room-day) and its travel flags, so the grid reads what the tracker reads and writes what Staff room / Reset already write. A pure model (`lib/scheduleGrid.ts`) decides what a tap means — insert, update flags, move room, delete, or refuse — and is unit-tested without a database; `components/ScheduleGrid.tsx` renders and performs verified writes with optimistic paint and revert, the tracker's pattern. Adding a person reuses `StaffRoomModal` (its "apply to all remaining days" is exactly "every day as Work in this room").

**Tech Stack:** Next.js 16 App Router, Supabase JS (browser client, RLS-checked writes), Tailwind tokens, the repo's plain-Node tests.

## Global Constraints

- **Desktop first** (Dan, 2026-09-06): design and verify at **1440×900** with the seeded Northwind show (6 days, 3 rooms, 10 crew); phone widths must scroll the grid inside its own `overflow-x-auto` container, never the page.
- **Every browser write is verified** (`.select('id')` + row count) and optimistic with revert on refusal.
- **Never delete a worked day silently**: un-painting a cell whose timecard has punches REFUSES with a plain sentence — same manners as the absence flag.
- **Absence** (no-show / cancelled, 0027) is not a grid state: shown muted, not cyclable.
- **Rooms are never deleted from the grid**; painting into a room-day that does not exist creates the room on that day (`rooms` insert), like the tracker's Add Room.
- Rates are NOT shown in the grid (they have their own section and permission).
- Token-driven styling only; the grid wears the positions grid's vocabulary (`components/CrewCallGrid.tsx`: day headers tinted by `dayTypeBgClass`, sticky first column, `border-b border-line` rows closed by a 3px ink rule).
- Copy in plain English; "position", never "call".
- `npm run build` before done; `rm -rf .next` after a build if dev was running; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; `scheduling` is preview-only, `main` deploys.

---

## File map

| File | Responsibility |
|---|---|
| `lib/scheduleGrid.ts` (new, plain module) | `CellState`, `cellStateOf(tc)`, `nextState(s)`, `flagsFor(s)`, `planChange(...)` — the decision, pure |
| `scripts/test/scheduleGrid.mts` (new) + `package.json` | tests for the model; wired into `npm test` |
| `app/dashboard/shows/[id]/edit/page.tsx` | loads day types, every room-day, every live timecard with flags/absence, punch counts; renders `<ScheduleGrid>` |
| `components/ScheduleGrid.tsx` (new, `'use client'`) | the grid: room picker, headers, rows, cells, tap cycle, right-click/long-press menu, writes |
| `components/NewShowClient.tsx:286` | finish lands on `/dashboard/shows/<id>/edit#schedule` |
| `CLAUDE.md` | the grid, the rule "a cell is a timecard", the desktop-first note |

---

### Task 1: The pure model — what a tap means

**Files:**
- Create: `lib/scheduleGrid.ts`
- Create: `scripts/test/scheduleGrid.mts`
- Modify: `package.json` (add `test:grid`; add it to `test`)

**Interfaces (Produces):**
```ts
export type CellState = 'empty' | 'work' | 'travel_in' | 'travel_out' | 'travel'
export type GridTimecard = {
  id: string; room_id: string; crew_member_id: string | null; crew_member_name: string; role: string
  is_travel_day: boolean; travel_in_day: boolean; travel_out_day: boolean
  absence: 'no_show' | 'cancelled' | null; punchCount: number
}
export function cellStateOf(tc: GridTimecard | undefined): CellState
export function nextState(s: CellState): CellState            // empty→work→travel_in→travel_out→travel→empty
export function flagsFor(s: Exclude<CellState, 'empty'>): { is_travel_day: boolean; travel_in_day: boolean; travel_out_day: boolean }
export type CellChange =
  | { kind: 'insert'; roomId: string | null; flags: ReturnType<typeof flagsFor> }   // roomId null = the room must be created on that day first
  | { kind: 'update'; timecardId: string; flags: ReturnType<typeof flagsFor> }
  | { kind: 'move'; timecardId: string; toRoomId: string | null; flags: ReturnType<typeof flagsFor> }
  | { kind: 'delete'; timecardId: string }
  | { kind: 'refuse'; reason: string }
  | { kind: 'none' }
export function planChange(args: {
  current: GridTimecard | undefined          // this person's card on this day (in any room), if any
  to: CellState
  selectedRoomId: string | null              // the selected room's instance on this day, null if it does not exist that day
  dayLabel: string                           // "Wednesday" — for the refusal sentence
  personName: string
}): CellChange
```

- [ ] **Step 1: Write the failing tests** — `scripts/test/scheduleGrid.mts`:

```ts
// The schedule grid's model: what a tap on a cell means. Pure — no database.
import { cellStateOf, nextState, flagsFor, planChange, type GridTimecard } from '../../lib/scheduleGrid.ts'

let pass = 0, fail = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`)
}
const tc = (over: Partial<GridTimecard> = {}): GridTimecard => ({
  id: 'tc1', room_id: 'roomA', crew_member_id: 'sam', crew_member_name: 'Sam', role: 'A1',
  is_travel_day: false, travel_in_day: false, travel_out_day: false, absence: null, punchCount: 0, ...over,
})

console.log('=== cell state ===')
check('no card is empty', cellStateOf(undefined), 'empty')
check('a plain card is work', cellStateOf(tc()), 'work')
check('travel in', cellStateOf(tc({ travel_in_day: true })), 'travel_in')
check('travel out', cellStateOf(tc({ travel_out_day: true })), 'travel_out')
check('a pure travel day', cellStateOf(tc({ is_travel_day: true })), 'travel')
check('is_travel_day wins over a stray leg flag', cellStateOf(tc({ is_travel_day: true, travel_in_day: true })), 'travel')

console.log('\n=== the tap cycle ===')
check('empty → work', nextState('empty'), 'work')
check('work → travel in', nextState('work'), 'travel_in')
check('travel in → travel out', nextState('travel_in'), 'travel_out')
check('travel out → travel', nextState('travel_out'), 'travel')
check('travel → empty', nextState('travel'), 'empty')

console.log('\n=== flags ===')
check('work clears every flag', flagsFor('work'), { is_travel_day: false, travel_in_day: false, travel_out_day: false })
check('travel in', flagsFor('travel_in'), { is_travel_day: false, travel_in_day: true, travel_out_day: false })
check('travel', flagsFor('travel'), { is_travel_day: true, travel_in_day: false, travel_out_day: false })

console.log('\n=== what a change means ===')
const base = { dayLabel: 'Wednesday', personName: 'Sam' }
check('empty → work inserts into the selected room',
  planChange({ ...base, current: undefined, to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'insert', roomId: 'roomA', flags: flagsFor('work') })
check('empty → work when the room is not on that day asks for the room first',
  planChange({ ...base, current: undefined, to: 'work', selectedRoomId: null }),
  { kind: 'insert', roomId: null, flags: flagsFor('work') })
check('work → travel in updates the flags in place',
  planChange({ ...base, current: tc(), to: 'travel_in', selectedRoomId: 'roomA' }),
  { kind: 'update', timecardId: 'tc1', flags: flagsFor('travel_in') })
check('a card in another room MOVES to the selected room',
  planChange({ ...base, current: tc({ room_id: 'roomB' }), to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'move', timecardId: 'tc1', toRoomId: 'roomA', flags: flagsFor('work') })
check('work → empty deletes an unpunched card',
  planChange({ ...base, current: tc(), to: 'empty', selectedRoomId: 'roomA' }),
  { kind: 'delete', timecardId: 'tc1' })
check('but refuses when the day has punches',
  planChange({ ...base, current: tc({ punchCount: 2 }), to: 'empty', selectedRoomId: 'roomA' }),
  { kind: 'refuse', reason: "Clear Sam's punches on Wednesday first — a worked day is never removed silently." })
check('and refuses to move a punched card between rooms',
  planChange({ ...base, current: tc({ room_id: 'roomB', punchCount: 1 }), to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'refuse', reason: "Clear Sam's punches on Wednesday first — a worked day is never moved silently." })
check('an absent day is not the grid\'s to change',
  planChange({ ...base, current: tc({ absence: 'cancelled' }), to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'refuse', reason: 'Wednesday is marked Cancelled on the tracker. Clear that there first.' })
check('same state, same room: nothing to do',
  planChange({ ...base, current: tc(), to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'none' })
check('empty → empty: nothing to do',
  planChange({ ...base, current: undefined, to: 'empty', selectedRoomId: 'roomA' }),
  { kind: 'none' })

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
```

- [ ] **Step 2: Wire the script and run it** — in `package.json` add
  `"test:grid": "node --no-warnings --import ./scripts/test/alias-loader.mjs --experimental-strip-types scripts/test/scheduleGrid.mts"` and change `"test"` to `"npm run test:payroll && npm run test:schedule && npm run test:clock && npm run test:grid && npm run test:rls"`.
  Run: `npm run test:grid` → fails: `Cannot find module '../../lib/scheduleGrid.ts'`.

- [ ] **Step 3: Write `lib/scheduleGrid.ts`**

```ts
// The schedule grid's model: a cell is a TIMECARD (person × room-day) and its
// travel flags, so this module never invents data — it only says what a tap
// means in terms the tracker already writes. Pure, no 'use client', tested in
// scripts/test/scheduleGrid.mts. Section 4 of the 2026-09-06 spec.

export type CellState = 'empty' | 'work' | 'travel_in' | 'travel_out' | 'travel'

export type GridTimecard = {
  id: string
  room_id: string
  crew_member_id: string | null
  crew_member_name: string
  role: string
  is_travel_day: boolean
  travel_in_day: boolean
  travel_out_day: boolean
  absence: 'no_show' | 'cancelled' | null
  /** Punches on this card. A worked day is never removed or moved silently. */
  punchCount: number
}

export const CELL_LABELS: Record<CellState, string> = {
  empty: 'Not working', work: 'Work', travel_in: 'Travel In', travel_out: 'Travel Out', travel: 'Travel',
}

/** The state a card reads as. is_travel_day (no work at all) outranks a leg. */
export function cellStateOf(tc: GridTimecard | undefined): CellState {
  if (!tc) return 'empty'
  if (tc.is_travel_day) return 'travel'
  if (tc.travel_in_day) return 'travel_in'
  if (tc.travel_out_day) return 'travel_out'
  return 'work'
}

const CYCLE: CellState[] = ['empty', 'work', 'travel_in', 'travel_out', 'travel']

/** One tap: the next state round the cycle. */
export function nextState(s: CellState): CellState {
  return CYCLE[(CYCLE.indexOf(s) + 1) % CYCLE.length]
}

export function flagsFor(s: Exclude<CellState, 'empty'>) {
  return {
    is_travel_day: s === 'travel',
    travel_in_day: s === 'travel_in',
    travel_out_day: s === 'travel_out',
  }
}

export type CellChange =
  | { kind: 'insert'; roomId: string | null; flags: ReturnType<typeof flagsFor> }
  | { kind: 'update'; timecardId: string; flags: ReturnType<typeof flagsFor> }
  | { kind: 'move'; timecardId: string; toRoomId: string | null; flags: ReturnType<typeof flagsFor> }
  | { kind: 'delete'; timecardId: string }
  | { kind: 'refuse'; reason: string }
  | { kind: 'none' }

/**
 * What changing this person's cell on this day to `to` means. `current` is
 * their card on that day in ANY room; `selectedRoomId` is the picker's room on
 * that day (null when that room does not exist that day yet — the caller
 * creates it first).
 */
export function planChange({ current, to, selectedRoomId, dayLabel, personName }: {
  current: GridTimecard | undefined
  to: CellState
  selectedRoomId: string | null
  dayLabel: string
  personName: string
}): CellChange {
  if (current?.absence) {
    const label = current.absence === 'cancelled' ? 'Cancelled' : 'No-show'
    return { kind: 'refuse', reason: `${dayLabel} is marked ${label} on the tracker. Clear that there first.` }
  }
  if (to === 'empty') {
    if (!current) return { kind: 'none' }
    if (current.punchCount > 0) {
      return { kind: 'refuse', reason: `Clear ${personName}'s punches on ${dayLabel} first — a worked day is never removed silently.` }
    }
    return { kind: 'delete', timecardId: current.id }
  }
  const flags = flagsFor(to)
  if (!current) return { kind: 'insert', roomId: selectedRoomId, flags }
  const sameRoom = selectedRoomId !== null && current.room_id === selectedRoomId
  if (!sameRoom) {
    if (current.punchCount > 0) {
      return { kind: 'refuse', reason: `Clear ${personName}'s punches on ${dayLabel} first — a worked day is never moved silently.` }
    }
    return { kind: 'move', timecardId: current.id, toRoomId: selectedRoomId, flags }
  }
  if (cellStateOf(current) === to) return { kind: 'none' }
  return { kind: 'update', timecardId: current.id, flags }
}
```

- [ ] **Step 4: Run** `npm run test:grid` → `22 passed, 0 failed`. Then `npm test` → every suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/scheduleGrid.ts scripts/test/scheduleGrid.mts package.json
git commit -m "Schedule grid model: a cell is a timecard; what a tap means, pure and tested.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 2: Edit Show loads the grid's data and renders it read-only

**Files:**
- Modify: `app/dashboard/shows/[id]/edit/page.tsx`
- Create: `components/ScheduleGrid.tsx`

**Interfaces:**
- Consumes: `cellStateOf`, `CELL_LABELS`, `GridTimecard` (Task 1); `dayTypeBgClass`, `dayTypeLabel` (`lib/dayTypes.ts`); `BAND`, `RULE_MAJOR` (`lib/panel.ts`); `Select` (`components/ui/Select`).
- Produces: `<ScheduleGrid>` props:
  ```ts
  {
    showId: string
    organizationId: string
    days: { id: string; date: string; day_number: number; day_type: string | null }[]
    rooms: { id: string; name: string; work_day_id: string }[]        // every room-day
    timecards: GridTimecard[]                                          // live (declined excluded)
    locked: boolean
    canEdit: boolean                                                   // can_edit_timecards
  }
  ```

- [ ] **Step 1: Load.** In `app/dashboard/shows/[id]/edit/page.tsx` the `timecards` read already exists (`fetchLiveTimecards` with a narrow column list). Widen its column list to `'id, crew_member_id, crew_member_name, role, room_id, is_travel_day, travel_in_day, travel_out_day, absence'` (the Crew & Rates dedupe below it ignores the extra columns). After that `Promise.all`, add the punch counts:

```ts
  // Punch counts per timecard, for the schedule grid: a worked day is never
  // removed or moved from the grid, so each cell has to know. One query for
  // the show, grouped here.
  const timecardIds = (timecards || []).map(t => t.id)
  const { data: punchRows } = timecardIds.length > 0
    ? await supabase.from('punches').select('timecard_id').in('timecard_id', timecardIds)
    : { data: [] as { timecard_id: string }[] }
  const punchCount = new Map<string, number>()
  for (const p of punchRows || []) punchCount.set(p.timecard_id, (punchCount.get(p.timecard_id) ?? 0) + 1)
  const gridTimecards: GridTimecard[] = (timecards || []).map(t => ({
    id: t.id, room_id: t.room_id, crew_member_id: t.crew_member_id, crew_member_name: t.crew_member_name,
    role: t.role, is_travel_day: !!t.is_travel_day, travel_in_day: !!t.travel_in_day,
    travel_out_day: !!t.travel_out_day, absence: (t as any).absence ?? null, punchCount: punchCount.get(t.id) ?? 0,
  }))
```

(import `type GridTimecard` from `@/lib/scheduleGrid`). `workDays` is already selected with `*`, so `day_type` is present. Render, as the first child inside `<EditShowClient>` (above `CrewClockPanel`), so it sits right after the show's own sections:

```tsx
      {canEditTimecards && (
        <ScheduleGrid
          showId={show.id}
          organizationId={user.organizationId!}
          days={(workDays || []).map(d => ({ id: d.id, date: d.date, day_number: d.day_number, day_type: d.day_type ?? null }))}
          rooms={rooms || []}
          timecards={gridTimecards}
          locked={!!show.finalized_at}
          canEdit={canEditTimecards}
        />
      )}
```

(`canEditTimecards` is already computed on this page for `CrewClockPanel`; confirm the name with `grep -n canEditTimecards`.)

- [ ] **Step 2: The component, read-only.** Create `components/ScheduleGrid.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Select from '@/components/ui/Select'
import { BAND } from '@/lib/panel'
import { cn } from '@/lib/cn'
import { dayTypeBgClass, dayTypeLabel } from '@/lib/dayTypes'
import { cellStateOf, CELL_LABELS, type CellState, type GridTimecard } from '@/lib/scheduleGrid'

// Who works which days, in which room, with their own travel dates — one grid
// (Section 4 of the 2026-09-06 spec). A cell IS a timecard: the same row the
// tracker's Staff room creates and Reset deletes, so this and the tracker can
// never disagree. Desktop first (Dan): verified at 1440×900; on a phone the
// grid scrolls inside itself, never the page.
//
// Same family as New Show's positions grid (CrewCallGrid): day headers tinted
// by day type, a sticky first column, hairline rows closed by a 3px rule.

type Day = { id: string; date: string; day_number: number; day_type: string | null }
type RoomDay = { id: string; name: string; work_day_id: string }

const STATE_CLASS: Record<CellState, string> = {
  empty: 'bg-bg text-muted/40',
  work: 'bg-accent text-accent-ink',
  travel_in: 'bg-day-travel text-white',
  travel_out: 'bg-day-travel text-white',
  travel: 'bg-day-travel/60 text-white',
}
const STATE_GLYPH: Record<CellState, string> = { empty: '', work: '●', travel_in: '→', travel_out: '←', travel: '✈' }

function dayHead(date: string) {
  const d = new Date(date + 'T00:00:00')
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    day: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    long: d.toLocaleDateString(undefined, { weekday: 'long' }),
  }
}

function initials(name: string) {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function ScheduleGrid({
  showId, organizationId, days, rooms, timecards: initial, locked, canEdit,
}: {
  showId: string
  organizationId: string
  days: Day[]
  rooms: RoomDay[]
  timecards: GridTimecard[]
  locked: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [timecards, setTimecards] = useState(initial)
  const [error, setError] = useState('')

  // Room NAMES, across every day (a room is a per-day row in the database).
  const roomNames = useMemo(() => [...new Set(rooms.map(r => r.name))].sort((a, b) => a.localeCompare(b)), [rooms])
  const [roomName, setRoomName] = useState(roomNames[0] ?? '')
  const roomIdOn = (dayId: string, name: string) => rooms.find(r => r.work_day_id === dayId && r.name === name)?.id ?? null
  const roomById = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms])
  const dayOfRoom = (roomId: string) => roomById.get(roomId)?.work_day_id

  // People, one row each, by directory id (name as the fallback key for
  // historical cards with no id — the same key Reports use).
  const people = useMemo(() => {
    const byKey = new Map<string, { key: string; crewMemberId: string | null; name: string; role: string }>()
    for (const t of timecards) {
      const key = t.crew_member_id ?? t.crew_member_name
      if (!byKey.has(key)) byKey.set(key, { key, crewMemberId: t.crew_member_id, name: t.crew_member_name, role: t.role })
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [timecards])

  // This person's card on this day, preferring the selected room.
  function cardFor(personKey: string, dayId: string): GridTimecard | undefined {
    const mine = timecards.filter(t => (t.crew_member_id ?? t.crew_member_name) === personKey && dayOfRoom(t.room_id) === dayId)
    const selected = roomIdOn(dayId, roomName)
    return mine.find(t => t.room_id === selected) ?? mine[0]
  }

  const gridTemplateColumns = `220px repeat(${days.length}, minmax(64px, 1fr))`

  return (
    <section id="schedule" className="mb-8">
      <div className={cn(BAND, 'flex flex-wrap items-center justify-between gap-3 px-4 py-2')}>
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Schedule</h2>
        {roomNames.length > 1 && (
          <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-band-ink/80">
            Room
            <Select ariaLabel="Room" size="sm" value={roomName} onChange={setRoomName}
              options={roomNames.map(n => ({ value: n, label: n }))} />
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: 220 + days.length * 64 }}>
          <div className="grid border-b-2 border-ink" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-20 bg-surface-2 px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Crew</div>
            {days.map(d => {
              const h = dayHead(d.date)
              const tint = dayTypeBgClass(d.day_type)
              const roomExists = roomIdOn(d.id, roomName) !== null
              return (
                <div key={d.id} title={roomExists ? undefined : `${roomName} is not on ${h.long} yet — tapping a cell adds it`}
                  className={cn('px-1 py-1.5 text-center', tint ?? 'bg-surface-2', tint && 'text-white', !roomExists && 'opacity-50')}>
                  <div className={cn('text-[9px] uppercase', tint ? 'text-white/80' : 'text-muted')}>{h.weekday}</div>
                  <div className={cn('text-[13px] font-bold', tint ? 'text-white' : 'text-ink')}>{h.day}</div>
                  {dayTypeLabel(d.day_type) && (
                    <div className={cn('truncate font-display text-[9px] uppercase leading-tight', tint ? 'text-white' : 'text-accent')}>{dayTypeLabel(d.day_type)}</div>
                  )}
                </div>
              )
            })}
          </div>

          {people.map(p => (
            <div key={p.key} className="grid border-b border-line last:border-b-[3px] last:border-ink" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r border-line bg-bg px-3 py-1.5">
                <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
                <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-muted">{p.role}</span>
              </div>
              {days.map(d => {
                const card = cardFor(p.key, d.id)
                const state = cellStateOf(card)
                const room = card ? roomById.get(card.room_id) : undefined
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!canEdit || locked}
                    aria-label={`${p.name}, ${dayHead(d.date).long}: ${card?.absence ? card.absence : CELL_LABELS[state]}${room ? ` in ${room.name}` : ''}`}
                    className={cn(
                      'm-1 flex h-9 flex-col items-center justify-center rounded-field text-xs font-semibold transition-colors disabled:cursor-default',
                      card?.absence ? 'bg-surface-3 text-muted' : STATE_CLASS[state],
                      !card?.absence && state === 'empty' && canEdit && !locked && 'hover:bg-surface-2',
                    )}
                  >
                    {card?.absence ? (card.absence === 'cancelled' ? '⊘' : '✕') : STATE_GLYPH[state]}
                    {room && roomNames.length > 1 && <span className="text-[9px] font-normal opacity-80">{initials(room.name)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
          {people.length === 0 && (
            <p className="p-4 text-sm text-muted">Nobody is staffed yet.</p>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {locked && <p className="mt-2 text-xs text-muted">Times are locked — the final report has been sent. An admin or the show’s PM can unlock the show.</p>}
    </section>
  )
}
```

(`router`, `supabase`, `setTimecards`, `setError`, `showId`, `organizationId` are unused until Task 3 — leave them; the build's lint may warn, not fail. If it fails, prefix with `void`.)

- [ ] **Step 3: Look at it, desktop first.** `npx tsc --noEmit`; start dev; in the pane `resize_window` to 1280×800 (the pane's max; note the spec's 1440 is a laptop screen — the layout is fluid) and open `/dashboard/shows/dda32c18-afd4-4105-a9f6-724b1e8011f9/edit#schedule` (Northwind, dev). Confirm with `read_page`/a screenshot: the Schedule band with the Room picker (3 rooms), six day columns with tints, ten crew rows with `●` on their days and room initials, day columns dimmed where the selected room does not run. Then `resize_window` to `mobile` and confirm the page has no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`) while the grid's container does.

- [ ] **Step 4: Commit** (stop dev, build, `rm -rf .next`)

```bash
git add app/dashboard/shows/[id]/edit/page.tsx components/ScheduleGrid.tsx
git commit -m "Schedule grid on Edit Show, read-only: crew × days, room picker, day-type headers.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 3: Tapping a cell writes — insert, flags, move, delete, refuse; rooms created on demand

**Files:**
- Modify: `components/ScheduleGrid.tsx`

**Interfaces:**
- Consumes: `nextState`, `planChange` (Task 1).

- [ ] **Step 1: The write.** Add to `ScheduleGrid` (below `cardFor`):

```tsx
  const [busyCell, setBusyCell] = useState<string | null>(null)   // `${personKey}|${dayId}`

  // Verified writes, optimistic paint, revert on refusal — the tracker's
  // pattern (TimecardRow.toggleFlag). One cell at a time.
  async function change(personKey: string, day: Day, to: CellState) {
    if (!canEdit || locked || busyCell) return
    setError('')
    const person = people.find(p => p.key === personKey)!
    const current = cardFor(personKey, day.id)
    const selectedRoomId = roomIdOn(day.id, roomName)
    const plan = planChange({ current, to, selectedRoomId, dayLabel: dayHead(day.date).long, personName: person.name })
    if (plan.kind === 'none') return
    if (plan.kind === 'refuse') { setError(plan.reason); return }

    const cellKey = `${personKey}|${day.id}`
    setBusyCell(cellKey)
    const before = timecards

    // The selected room may not exist on this day yet: create it first, the
    // way the tracker's Add Room does, and say so.
    async function ensureRoom(): Promise<string | null> {
      if (selectedRoomId) return selectedRoomId
      const { data, error } = await supabase.from('rooms')
        .insert({ work_day_id: day.id, name: roomName }).select('id, name, work_day_id')
      if (error || !data || data.length === 0) { setError(error?.message ?? 'Could not add the room to that day.'); return null }
      router.refresh()   // the rooms prop is re-read on refresh; until then this id is used directly
      return data[0].id
    }

    try {
      if (plan.kind === 'insert') {
        const roomId = await ensureRoom(); if (!roomId) return
        const draft: GridTimecard = {
          id: `draft-${cellKey}`, room_id: roomId, crew_member_id: person.crewMemberId, crew_member_name: person.name,
          role: person.role, absence: null, punchCount: 0, ...plan.flags,
        }
        setTimecards(t => [...t, draft])
        const { data, error } = await supabase.from('timecards')
          .insert({ room_id: roomId, crew_member_id: person.crewMemberId, crew_member_name: person.name, role: person.role, ...plan.flags })
          .select('id')
        if (error || !data || data.length === 0) throw new Error(error?.message ?? 'That did not save — you may not have permission to staff this show.')
        setTimecards(t => t.map(x => x.id === draft.id ? { ...x, id: data[0].id } : x))
      } else if (plan.kind === 'update') {
        setTimecards(t => t.map(x => x.id === plan.timecardId ? { ...x, ...plan.flags } : x))
        const { data, error } = await supabase.from('timecards').update(plan.flags).eq('id', plan.timecardId).select('id')
        if (error || !data || data.length === 0) throw new Error(error?.message ?? 'That did not save.')
      } else if (plan.kind === 'move') {
        const roomId = plan.toRoomId ?? await ensureRoom(); if (!roomId) return
        setTimecards(t => t.map(x => x.id === plan.timecardId ? { ...x, room_id: roomId, ...plan.flags } : x))
        const { data, error } = await supabase.from('timecards').update({ room_id: roomId, ...plan.flags }).eq('id', plan.timecardId).select('id')
        if (error || !data || data.length === 0) {
          throw new Error(error?.code === '23505' ? `${person.name} is already in ${roomName} that day.` : (error?.message ?? 'That did not save.'))
        }
      } else if (plan.kind === 'delete') {
        setTimecards(t => t.filter(x => x.id !== plan.timecardId))
        const { data, error } = await supabase.from('timecards').delete().eq('id', plan.timecardId).select('id')
        if (error || !data || data.length === 0) throw new Error(error?.message ?? 'That did not save.')
      }
      router.refresh()
    } catch (e: any) {
      setTimecards(before)
      setError(e.message)
    } finally {
      setBusyCell(null)
    }
  }
```

Wire the cell button: `onClick={() => change(p.key, d, nextState(state))}` and `onContextMenu={e => { e.preventDefault(); setMenu({ personKey: p.key, day: d, x: e.clientX, y: e.clientY }) }}`; add `disabled={!canEdit || locked || busyCell !== null}`.

- [ ] **Step 2: The menu** (right-click / long-press): state `const [menu, setMenu] = useState<{ personKey: string; day: Day; x: number; y: number } | null>(null)`; render when set, as a paper-slip overlay (`fixed z-50 border-2 border-ink bg-surface shadow-edge`) at `(x, y)` listing the five states from `CELL_LABELS` plus a separator, each `<button>` calling `change(menu.personKey, menu.day, state)` then `setMenu(null)`; a `fixed inset-0` transparent backdrop closes it; `Escape` closes it (`useEffect` keydown). Long-press: `onPointerDown` starts a 500 ms timer that opens the menu at the pointer; `onPointerUp`/`onPointerLeave` clears it.

- [ ] **Step 3: Keyboard.** Cells are buttons, so Tab/Space already work; add `onKeyDown` on the grid container: arrow keys move focus between cell buttons (query `button[data-cell]`; give each cell `data-cell={`${p.key}|${d.id}`}` and compute the neighbour by row/column index).

- [ ] **Step 4: Prove every branch on dev** (Northwind, `?d` irrelevant here). With dev running and the pane at 1280×800 on `/edit#schedule`:
  1. Pick a person with an empty day → tap → `●` appears at once; `select room_id, is_travel_day from timecards where crew_member_id=… and room_id in (…day's rooms)` on dev shows the row.
  2. Tap again three times → `→`, `←`, `✈`; the row's flags follow (`travel_in_day`, `travel_out_day`, `is_travel_day`).
  3. Tap once more → empty; the row is gone.
  4. Tap a day where that person HAS punches (Avery, day 2) to empty → the refusal sentence appears; the row is untouched.
  5. Change the Room picker to a room that is NOT on day 5 (check the header dims) → tap a person's empty day-5 cell → the room row appears on that day (`select name from rooms where work_day_id=…`) and the timecard is in it; the header un-dims after refresh.
  6. Same person, switch Room back → tap the same cell → the card MOVES room (the initials change; `room_id` changes in the database).
  7. Right-click a cell → menu with five states; pick Travel Out → `←`.
  8. Reset every test change with SQL (delete the rows you created; the room-day too), so the seeded show is as it was.

- [ ] **Step 5: Commit** (build first)

```bash
git add components/ScheduleGrid.tsx
git commit -m "Schedule grid writes: tap cycles a day, right-click picks; rooms created on demand; worked days refuse.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 4: Adding a person, the New Show hand-off, docs

**Files:**
- Modify: `components/ScheduleGrid.tsx`
- Modify: `components/NewShowClient.tsx:286`
- Modify: `CLAUDE.md`

- [ ] **Step 1: "+ Add crew" reuses `StaffRoomModal`.** Its "apply to all remaining days" (`remainingRoomIdsSameName`) is exactly "every show day as Work in the selected room". In `ScheduleGrid`, compute for the selected room name the instances in day order: `const instances = days.map(d => roomIdOn(d.id, roomName)).filter((x): x is string => !!x)`; render, in the band, a `Button size="sm"` "+ Add crew" that opens:

```tsx
<StaffRoomModal
  locked={locked}
  organizationId={organizationId}
  roomId={instances[0]}
  roomName={roomName}
  currentWorkDayId={roomById.get(instances[0])!.work_day_id}
  remainingRoomIdsSameName={instances.slice(1)}
  dayAssignments={[]}
  canEditRates={canEditRates}
  open={adding}
  onOpenChange={setAdding}
/>
```

Read `StaffRoomModal`'s props first (`sed -n 19,45p components/StaffRoomModal.tsx`) and match them exactly — it may render its own trigger button rather than take `open`; if so, render it as-is inside the band and skip the custom button. Add `canEditRates: boolean` to `ScheduleGrid`'s props and pass `user.can('can_edit_pay_rates')` from the page. If the selected room has no instances (a room that exists on no day — impossible today) disable the button with a title.

- [ ] **Step 2: New Show lands on the grid.** In `components/NewShowClient.tsx` change `router.push(\`/dashboard/shows/${showId}\`)` to `router.push(\`/dashboard/shows/${showId}/edit#schedule\`)` with the comment: `// Details → rules → rooms/positions → schedule: the show exists now, so its people can be given their days (Section 4).`

- [ ] **Step 3: Prove it.** On dev: create a throwaway show through New Show (2 days, 2 rooms) → you land on Edit Show scrolled to Schedule → "+ Add crew" → pick two people → both appear with `●` on both days in the selected room. Delete the throwaway show afterwards (Edit Show → the existing archive/delete, or SQL `delete from shows where id=…` — cascades).

- [ ] **Step 4: CLAUDE.md.** In the "Show access" section add a sub-heading **"The schedule grid (Section 4, 2026-09-07)"**: a cell is a timecard (person × room-day) + its travel flags — the grid invents no data and writes what Staff room / Reset write; the tap cycle; the room picker and on-demand room creation; the two refusals (punched day never removed or moved; absence is the tracker's); `lib/scheduleGrid.ts` is the tested model; **desktop first** per Dan; adding people is `StaffRoomModal` with apply-to-all-days; New Show hands off to `#schedule`. Update the file map (`components/ScheduleGrid.tsx`, `lib/scheduleGrid.ts`, `scripts/test/scheduleGrid.mts`) and the test count.

- [ ] **Step 5: Build, commit, and STOP for Dan's first-cut review** (blast radius: `scheduling` only, preview; no database change; merging to `main` is the ship).

```bash
npm run build && rm -rf .next
git add components/ScheduleGrid.tsx components/NewShowClient.tsx app/dashboard/shows/[id]/edit/page.tsx CLAUDE.md
git commit -m "Schedule grid: add crew via Staff room (every day as Work), New Show lands on the grid; docs.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

Then send Dan a screenshot of the grid at desktop width (the pane's screenshot, or `SendUserFile`), list what each control does in five lines, and ask what to change before it ships. Expect iteration — Dan: "this is the section we will spend the most time finessing."
