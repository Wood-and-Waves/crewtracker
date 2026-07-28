// The crew call as a grid: rooms down, days across.
//
// Plain module, no 'use client'. Pure functions over a plain object, so the
// whole model is unit-testable without a database or a browser — the same
// reason lib/crewCall.ts is shaped this way.
//
// WHY A GRID AT ALL
// -----------------
// A call is genuinely two-dimensional. Riggers come in for load-in and load-out
// and are gone in between; a teleprompter operator is only there for show days.
// The previous shape — one list per room plus a "which days?" dropdown — was a
// description of a grid rather than a grid, and it could not express a one-off
// change to a single day at all.
//
// Rooms are keyed by a client-generated key rather than by name, because a room
// can be renamed mid-build and its call must follow it.

export type GridLine = { role: string; quantity: number }

/** roomKey -> day index (0-based) -> the roles called there. */
export type CallModel = Record<string, Record<number, GridLine[]>>

export function cellLines(call: CallModel, roomKey: string, day: number): GridLine[] {
  return call[roomKey]?.[day] ?? []
}

/** Total people called in one cell. */
export function cellCount(lines: GridLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0)
}

function withCell(call: CallModel, roomKey: string, day: number, lines: GridLine[]): CallModel {
  const room = { ...(call[roomKey] ?? {}) }
  if (lines.length === 0) delete room[day]
  else room[day] = lines
  return { ...call, [roomKey]: room }
}

/**
 * Add a role to one cell.
 *
 * An existing role has its count bumped rather than producing a second line:
 * two "Stagehand ×1" rows say the same thing as one "×2" and only make the cell
 * harder to read.
 */
export function addRole(
  call: CallModel, roomKey: string, day: number, role: string, quantity = 1,
): CallModel {
  const lines = cellLines(call, roomKey, day)
  const i = lines.findIndex(l => l.role === role)
  const next = i >= 0
    ? lines.map((l, j) => (j === i ? { ...l, quantity: l.quantity + quantity } : l))
    : [...lines, { role, quantity }]
  return withCell(call, roomKey, day, next)
}

export function removeRole(call: CallModel, roomKey: string, day: number, role: string): CallModel {
  return withCell(call, roomKey, day, cellLines(call, roomKey, day).filter(l => l.role !== role))
}

export function clearDay(call: CallModel, roomKey: string, day: number): CallModel {
  return withCell(call, roomKey, day, [])
}

/**
 * Copy one cell onto other days of the same room, replacing whatever was there.
 *
 * This is how the bulk work gets done: type the first day once, then spread it.
 * Copying an EMPTY cell clears the targets, which is what "make these days look
 * like this one" has to mean if it is to be trusted.
 */
export function copyDayTo(
  call: CallModel, roomKey: string, fromDay: number, targetDays: number[],
): CallModel {
  const source = cellLines(call, roomKey, fromDay)
  let next = call
  for (const day of targetDays) {
    if (day === fromDay) continue
    next = withCell(next, roomKey, day, source.map(l => ({ ...l })))
  }
  return next
}

/** Whether a room has any positions at all, on any day. */
export function roomHasAnyCall(call: CallModel, roomKey: string): boolean {
  const room = call[roomKey]
  if (!room) return false
  return Object.values(room).some(lines => lines.length > 0)
}

/**
 * Which day indices a room should EXIST on.
 *
 * A room is created only on the days it is called — Breakout A is simply absent
 * on load-in day rather than present and empty.
 *
 * The exception matters: a room with no call anywhere is created on EVERY day.
 * Someone who adds "Breakout A" and no roles wants the room; having it vanish
 * entirely would be a bug, not a tidy-up.
 */
export function roomDayIndices(call: CallModel, roomKey: string, totalDays: number): number[] {
  if (!roomHasAnyCall(call, roomKey)) {
    return Array.from({ length: totalDays }, (_, i) => i)
  }
  const room = call[roomKey] ?? {}
  return Array.from({ length: totalDays }, (_, i) => i)
    .filter(i => (room[i] ?? []).length > 0)
}

/** People called per day across every room — drives the "12 a day" summary. */
export function peakPerDay(call: CallModel, totalDays: number): number {
  let peak = 0
  for (let day = 0; day < totalDays; day++) {
    let n = 0
    for (const room of Object.values(call)) n += cellCount(room[day] ?? [])
    if (n > peak) peak = n
  }
  return peak
}

export type PlannedPosition = {
  roomKey: string
  dayIndex: number
  role: string
  sortOrder: number
}

/**
 * Flatten the model into the positions to write.
 *
 * ONE ROW PER POSITION, never role-plus-quantity: each is individually open or
 * filled, and the person filling it attaches to that specific row.
 *
 * `sortOrder` restarts per cell so a room's call reads in the order it was
 * built on every day.
 */
export function plannedPositions(call: CallModel, totalDays: number): PlannedPosition[] {
  const out: PlannedPosition[] = []
  for (const [roomKey, byDay] of Object.entries(call)) {
    for (let day = 0; day < totalDays; day++) {
      let order = 0
      for (const line of byDay[day] ?? []) {
        for (let i = 0; i < line.quantity; i++) {
          out.push({ roomKey, dayIndex: day, role: line.role, sortOrder: order++ })
        }
      }
    }
  }
  return out
}
