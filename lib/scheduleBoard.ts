// The Scheduling screen's model: a show as ROOMS × POSITION LINES × DAYS.
//
// Pure — no database, no React — so the rules below are pinned by tests rather
// than read off the screen.
//
// THE SHAPE IS A GRID, AND A GRID KEEPS ITS ROWS (Dan, 2026-09-08: "Shifting
// things down when a stagehand joins and not having them line up doesn't make
// sense"). A cell used to be a stack of whatever that room-day held, so a role
// that ran on two days pushed every name below it down in those columns, and a
// person could sit on a different line each day. Now a room is a set of LINES —
// one per position — and a line runs the width of the show: the same person, or
// the open slot, or nothing at all on a day they are not on. You read across.
//
// A person keeps ONE line all week. Lines are packed, so two people who never
// work the same day share a line rather than each holding a mostly empty row.
//
// Rooms are per-DAY rows in the database, so a room here is a room NAME — the
// same key position_defs uses. A name that does not run on a day has no cell to
// fill, which is why roomIdByDate can be null.
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

/** One position, running the width of the show. */
export type BoardLine = {
  key: string
  role: string
  /** date → what is on this line that day; null on a day it is not needed. */
  byDate: Record<string, BoardEntry | null>
}

export type BoardRoom = {
  name: string
  /** date → the room's row that day, null when the room does not run. */
  roomIdByDate: Record<string, string | null>
  lines: BoardLine[]
}

export type BoardDay = { workDayId: string; date: string; activities: string[] }

export type BoardSummary = {
  /** Every position on the grid: open slots plus booked person-days. */
  total: number
  confirmed: number
  open: number
  /** Distinct PEOPLE still owing an answer, never person-days. */
  waitingPeople: number
  flags: number
}

export type Board = { days: BoardDay[]; rooms: BoardRoom[]; summary: BoardSummary }

export type BoardInput = {
  days: BoardDay[]
  rooms: { id: string; name: string; workDayId: string }[]
  slots: { id: string; roomId: string; role: string; sortOrder: number }[]
  /** Every LIVE timecard on the show; `slotId` is call_position_id. */
  bookings: (BoardBooking & { roomId: string; slotId: string | null })[]
  flags: SlotFlag[]
}

/** First name, then full name — the tracker's own convention (byFirstName). */
function nameKey(n: string): [string, string] {
  const full = (n || '').trim()
  return [full.split(/\s+/)[0].toLowerCase(), full.toLowerCase()]
}

const roleOf = (e: BoardEntry) => (e.kind === 'open' ? e.role : e.booking.role) || ''
const personKey = (b: BoardBooking) => b.crewMemberId ?? `name:${b.crewMemberName}`

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

  const boardRooms: BoardRoom[] = roomNames.map(name => {
    const roomIdByDate: Record<string, string | null> = {}
    const entriesByDate: Record<string, BoardEntry[]> = {}
    // Role order is the ROOM's own: where each role first appears in its slot
    // list, read day by day. A role only ever hand-staffed has no slot and
    // sorts after the ones the show asked for.
    const roleRank = new Map<string, number>()
    let rank = 0

    for (const day of days) {
      const roomId = roomIdFor.get(`${name}|${day.workDayId}`) ?? null
      roomIdByDate[day.date] = roomId
      const list: BoardEntry[] = []
      if (roomId) {
        const mine = [...(slotsByRoom.get(roomId) ?? [])]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        for (const s of mine) {
          if (!roleRank.has(s.role)) roleRank.set(s.role, rank++)
          const b = bySlot.get(s.id)
          list.push(b
            ? { kind: 'booked', slotId: s.id, roomId, booking: b, flag: flagBySlot.get(s.id) ?? null }
            : { kind: 'open', slotId: s.id, roomId, role: s.role })
        }
        for (const b of extras.filter(x => x.roomId === roomId)) {
          list.push({ kind: 'booked', slotId: null, roomId, booking: b, flag: null })
        }
      }
      entriesByDate[day.date] = list
    }

    const roles = [...new Set(days.flatMap(d => entriesByDate[d.date].map(roleOf)))]
      .sort((a, b) =>
        (roleRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (roleRank.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        a.localeCompare(b))

    const lines: BoardLine[] = []
    for (const role of roles) {
      const perDate: Record<string, BoardEntry[]> = {}
      for (const d of days) perDate[d.date] = entriesByDate[d.date].filter(e => roleOf(e) === role)

      // Who does this role in this room, and on which days.
      const byPerson = new Map<string, { name: string; dates: Map<string, BoardEntry> }>()
      for (const d of days) {
        for (const e of perDate[d.date]) {
          if (e.kind !== 'booked') continue
          const k = personKey(e.booking)
          const rec = byPerson.get(k) ?? { name: e.booking.crewMemberName, dates: new Map<string, BoardEntry>() }
          // One line per person per day; a second booking the same day (two
          // rooms of the same name cannot happen, so this is rare) falls
          // through to the pass below and takes another line.
          if (!rec.dates.has(d.date)) rec.dates.set(d.date, e)
          byPerson.set(k, rec)
        }
      }

      // The busiest people take their line first, so the top rows are the ones
      // that run all week and the sparse ones settle underneath.
      const people = [...byPerson.entries()].sort((a, b) =>
        b[1].dates.size - a[1].dates.size ||
        nameKey(a[1].name)[0].localeCompare(nameKey(b[1].name)[0]) ||
        nameKey(a[1].name)[1].localeCompare(nameKey(b[1].name)[1]) ||
        a[0].localeCompare(b[0]))

      const roleLines: BoardLine[] = []
      const placed = new Set<BoardEntry>()
      const newLine = () => {
        const line: BoardLine = {
          key: `${name}|${role}|${roleLines.length}`,
          role,
          byDate: Object.fromEntries(days.map(d => [d.date, null])) as Record<string, BoardEntry | null>,
        }
        roleLines.push(line)
        return line
      }

      for (const [, rec] of people) {
        const dates = [...rec.dates.keys()]
        const line = roleLines.find(l => dates.every(d => !l.byDate[d])) ?? newLine()
        for (const [d, e] of rec.dates) { line.byDate[d] = e; placed.add(e) }
      }
      // Then the open slots, into whatever line is free that day: a gap on a
      // line reads as "this position is open on Saturday", which is what it is.
      for (const d of days) {
        for (const e of perDate[d.date]) {
          if (placed.has(e)) continue
          const line = roleLines.find(l => !l.byDate[d.date]) ?? newLine()
          line.byDate[d.date] = e
          placed.add(e)
        }
      }
      lines.push(...roleLines)
    }

    return { name, roomIdByDate, lines }
  })

  // Counted FROM THE GRID, so the strip can never disagree with what is on it.
  let total = 0, confirmed = 0, open = 0, flagCount = 0
  const waiting = new Set<string>()
  for (const room of boardRooms) {
    for (const line of room.lines) {
      for (const e of Object.values(line.byDate)) {
        if (!e) continue
        total++
        if (e.kind === 'open') { open++; continue }
        if (e.flag) flagCount++
        if (e.booking.status === 'confirmed') confirmed++
        else waiting.add(personKey(e.booking))
      }
    }
  }

  return {
    days, rooms: boardRooms,
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
