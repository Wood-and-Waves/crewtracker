// What a show is doing on a day: any SET of five activities, chosen on a grid
// (Section A of the 2026-09-07 show-flow spec). Replaces the eight compound
// day types, which tried to name every combination and could not be finished
// ("Rehearsal/Show", "Travel/Load-in/Show"…). Label and colour are DERIVED.
//
// What this is not: a statement about any one person. Per-person travel is
// timecards.is_travel_day / travel_in_day / travel_out_day, and lib/payroll.ts
// must never import this file (the rule 0012 and 0015 drew).
//
// Plain module, no 'use client' — the server tracker page, the client grid and
// the test harness all import it.

export const ACTIVITIES = ['travel', 'load_in', 'rehearsal', 'show', 'load_out'] as const
export type Activity = typeof ACTIVITIES[number]

export const ACTIVITY_LABELS: Record<Activity, string> = {
  travel: 'Travel',
  load_in: 'Load-in',
  rehearsal: 'Rehearsal',
  show: 'Show',
  load_out: 'Load-out',
}

// Show chronology: travel in, load in, rehearse, show, load out. Travel is
// ambiguous — in at the start, home at the end — so it reads FIRST unless the
// day also loads out, when it is the trip home and reads last ("Load-out ·
// Travel"). A day that both loads in and loads out is a one-day show; travel
// on it reads first.
const ORDER: Record<Activity, number> = { travel: 0, load_in: 1, rehearsal: 2, show: 3, load_out: 4 }
function orderKey(a: Activity, set: ReadonlySet<Activity>): number {
  if (a === 'travel' && set.has('load_out') && !set.has('load_in')) return 5
  return ORDER[a]
}

export function isActivity(v: unknown): v is Activity {
  return typeof v === 'string' && (ACTIVITIES as readonly string[]).includes(v)
}

/** Unknown values dropped, duplicates collapsed, chronological order. */
export function normalizeActivities(value: unknown): Activity[] {
  if (!Array.isArray(value)) return []
  const set = new Set<Activity>()
  for (const v of value) if (isActivity(v)) set.add(v)
  return [...set].sort((a, b) => orderKey(a, set) - orderKey(b, set))
}

/**
 * "Travel · Load-in · Show", or null when there is nothing to say.
 *
 * Null covers both "nobody has set anything" and "the database holds values
 * this build has never heard of" — a row written by a newer version renders
 * as blank rather than printing a raw slug into an email to a crew member.
 */
export function dayLabel(activities: readonly string[] | null | undefined): string | null {
  const acts = normalizeActivities(activities)
  return acts.length ? acts.map(a => ACTIVITY_LABELS[a]).join(' · ') : null
}

export type DayTint = 'travel' | 'loadin' | 'rehearsal' | 'show'

/**
 * The day's BIGGEST activity decides the colour: show > rehearsal > load-in
 * or load-out (they share the amber) > travel. Same four --day-* tokens as
 * before; the one visible change from the old list is that a travel + load-in
 * day is amber now, not slate.
 */
export function dayTint(activities: readonly string[] | null | undefined): DayTint | null {
  const acts = normalizeActivities(activities)
  if (acts.includes('show')) return 'show'
  if (acts.includes('rehearsal')) return 'rehearsal'
  if (acts.includes('load_in') || acts.includes('load_out')) return 'loadin'
  if (acts.includes('travel')) return 'travel'
  return null
}

const TINT_CLASS: Record<DayTint, string> = {
  travel: 'bg-day-travel',
  loadin: 'bg-day-loadin',
  rehearsal: 'bg-day-rehearsal',
  show: 'bg-day-show',
}

/** Tailwind background class for a set, or null when there is nothing to tint. */
export function dayActivitiesBgClass(activities: readonly string[] | null | undefined): string | null {
  const t = dayTint(activities)
  return t ? TINT_CLASS[t] : null
}

/**
 * For positions "by kind" (Section B of the spec): a position is a role for
 * these kinds of day. 'custom' is never decided by activities — its dates are
 * explicit.
 */
export type DayKind = 'all' | 'show' | 'load' | 'custom'

export function isKindOfDay(activities: readonly string[] | null | undefined, kind: DayKind): boolean {
  const acts = normalizeActivities(activities)
  switch (kind) {
    case 'all': return true
    case 'show': return acts.includes('show')
    case 'load': return acts.includes('load_in') || acts.includes('load_out')
    case 'custom': return false
  }
}

// ---- The legacy eight (migrations 0015/0016), for the backfill and the mirror ----
//
// Must agree with day_type_to_activities() / activities_to_day_type() in
// migration 0032, which keep work_days.day_type mirrored until it is dropped.

const LEGACY_TO_ACTIVITIES: Record<string, Activity[]> = {
  travel_load_in: ['travel', 'load_in'],
  load_in: ['load_in'],
  load_in_show: ['load_in', 'show'],
  rehearsal: ['rehearsal'],
  show: ['show'],
  show_load_out: ['show', 'load_out'],
  load_out_travel: ['load_out', 'travel'],
  travel: ['travel'],
}

export function fromLegacy(dayType: string | null | undefined): Activity[] {
  return dayType && LEGACY_TO_ACTIVITIES[dayType] ? [...LEGACY_TO_ACTIVITIES[dayType]] : []
}

/**
 * The legacy slug for a set, or — when no compound name exists — the slug of
 * its biggest activity that HAS one. The legacy list never had a plain
 * 'load_out', so a load-out-only set has no honest legacy name and mirrors to
 * null.
 */
export function toLegacy(activities: readonly string[] | null | undefined): string | null {
  const acts = normalizeActivities(activities)
  if (!acts.length) return null
  const key = acts.join(',')
  for (const [slug, set] of Object.entries(LEGACY_TO_ACTIVITIES)) {
    if (normalizeActivities(set).join(',') === key) return slug
  }
  if (acts.includes('show')) return 'show'
  if (acts.includes('rehearsal')) return 'rehearsal'
  if (acts.includes('load_in')) return 'load_in'
  if (acts.includes('travel')) return 'travel'
  return null
}
