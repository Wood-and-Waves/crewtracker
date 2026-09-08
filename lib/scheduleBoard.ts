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
        for (const b of extras
          .filter(x => x.roomId === roomId)
          .sort((a, b2) => a.crewMemberName.localeCompare(b2.crewMemberName))) {
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
