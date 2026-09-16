// WHERE ELSE THEY ARE ALREADY COMMITTED, and on which days.
//
// Plain module, no 'use client': the picker renders it and the tests read it.
// It lives here rather than inside FillPositionPicker because the wording is a
// rule now — a scheduler decides whether to override a clash from this one
// line, so what it does and does not say is worth pinning.
//
// Scoped by the caller's own RLS to ONE ORGANIZATION. A person booked at
// another company is not a conflict here and must never become one — see the
// cross-organization rule in CLAUDE.md.

import { compressDays } from '@/lib/readyEmail'

export type BookingConflict = {
  showId: string
  showName: string
  roomName: string
  sameRoom: boolean
  status: string | null
  /** The day of the clash — one row per day, so a run produces several. */
  date: string
}

/**
 * "Booked on Harbour Point Gala — Tue 6 – Wed 7 · Booked on Westbrook Sales
 * Meeting — Sat 10"
 *
 * THE DATES ARE THE POINT (Dan, 2026-09-16). A run is booked in one press, so
 * "they are busy" without "on which days" gives a scheduler no way to judge
 * whether it matters — a clash on the load-in is not the clash on the show day.
 *
 * Grouped BY SHOW, so somebody out on one job at the start of the week and
 * another at the end reads as two facts rather than a wall of dates, and
 * consecutive days inside a job collapse to a range.
 *
 * Held dates and pending ones stay told apart: somebody who has merely been
 * asked has not taken the day off the table yet, and booking over that is a
 * different decision from booking over a yes.
 */
export function describeConflicts(conflicts: BookingConflict[]): string {
  const byShow = new Map<string, { name: string; confirmed: boolean; dates: Set<string> }>()
  for (const c of conflicts) {
    const e = byShow.get(c.showId) ?? { name: c.showName, confirmed: false, dates: new Set<string>() }
    if (c.status === 'confirmed') e.confirmed = true
    e.dates.add(c.date)
    byShow.set(c.showId, e)
  }
  return [...byShow.values()]
    .map(e => `${e.confirmed ? 'Booked on' : 'Pending on'} ${e.name} — ${compressDays([...e.dates])}`)
    .join(' · ')
}
