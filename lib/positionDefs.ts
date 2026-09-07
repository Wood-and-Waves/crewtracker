// Positions "by kind of day" — the browser-side twin of sync_position_slots()
// in migration 0034, so New Show can preview slot counts before the show
// exists, and so the rule is unit-tested. The DATABASE derivation is the
// truth; keep the two in step (position_def_wants() there, defWants() here).
//
// Plain module, no 'use client'.

import { isKindOfDay, type DayKind } from '@/lib/dayActivities'
export type { DayKind }

export const DAY_KINDS: DayKind[] = ['all', 'show', 'load', 'custom']

export const DAY_KIND_LABELS: Record<DayKind, string> = {
  all: 'All days',
  show: 'Show days',
  load: 'Load-in and load-out',
  custom: 'Custom dates',
}

export type PositionDef = {
  /** Client key (a uuid) on New Show; the row id on Edit Show. */
  key: string
  roomKey: string
  role: string
  count: number
  dayKind: DayKind
  /** YYYY-MM-DD, only read when dayKind is 'custom'. */
  customDates: string[]
}

export type GridDay = { date: string; activities: string[] }

/** Does this definition want a slot on this day? Mirrors position_def_wants(). */
export function defWants(def: Pick<PositionDef, 'dayKind' | 'customDates'>, day: GridDay): boolean {
  if (def.dayKind === 'custom') return def.customDates.includes(day.date)
  return isKindOfDay(day.activities, def.dayKind)
}

/**
 * roomKey → dayIndex → number of slots, for the grid's read-only cells.
 * `roomsOnDay` says whether the room exists that day (rooms are per day).
 */
export function derivedCounts(
  defs: PositionDef[],
  days: GridDay[],
  roomsOnDay: (roomKey: string, dayIndex: number) => boolean,
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

/** "Tue 3, Wed 4, Sun 8, Mon 9", "every day", or "no days yet". */
export function describeDefDays(def: PositionDef, days: GridDay[]): string {
  if (def.dayKind === 'all') return 'every day'
  const hit = days.filter(d => defWants(def, d))
  if (!hit.length) return 'no days yet'
  // "Tue 3", built by hand: en-US with weekday + day formats as "3 Tue".
  return hit
    .map(d => {
      const dt = new Date(d.date + 'T00:00:00')
      return `${dt.toLocaleDateString('en-US', { weekday: 'short' })} ${dt.getDate()}`
    })
    .join(', ')
}
