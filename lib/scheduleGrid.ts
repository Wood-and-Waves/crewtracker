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
  empty: 'Not working',
  work: 'Work',
  travel_in: 'Travel In',
  travel_out: 'Travel Out',
  travel: 'Travel',
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
 * creates it first, the way the tracker's Add Room does).
 */
export function planChange({ current, to, selectedRoomId, dayLabel, personName }: {
  current: GridTimecard | undefined
  to: CellState
  selectedRoomId: string | null
  dayLabel: string
  personName: string
}): CellChange {
  // An absent day (no-show / cancelled, 0027) is the tracker's decision, made
  // on the day it happened; the grid shows it and leaves it alone.
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
