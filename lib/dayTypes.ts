// The kinds of day a show run is made of.
//
// THE ARRAY IS THE ORDER. It runs in show chronology — travel in, load in,
// rehearse, show, load out, travel home — because that is the order somebody
// scanning a dropdown expects. Reordering the run, or adding an eighth kind, is
// an edit to this array plus its label: the New Show picker, the tracker and the
// booking request all read from here. (The list has already grown once, from
// five to seven, which is exactly why it lives in one place.)
//
// WHAT THIS IS, AND WHAT IT IS NOT
// --------------------------------
// A day type is PLANNING INFORMATION ABOUT THE SHOW: what the production is
// doing that day. It is NOT a statement about any one person.
//
// On a Travel/Load-in day some crew travel only, some travel and then work a
// full day, and some live in town and just turn up. That is what
// timecards.is_travel_day / travel_in_day / travel_out_day are for — per person,
// per day — and those are what payroll reads. A single show-wide label cannot
// express it and must not try.
//
// lib/payroll.ts must never import this file. Migration 0012 drew the same line
// around booking_status for the same reason: a scheduling state must never
// quietly decide what somebody gets paid.
//
// Plain module, no 'use client' — the server tracker page, the client picker and
// the test harness all import it.

/**
 * Stored values. These are the strings in the database, and they are slugs
 * rather than display text on purpose: changing the wording of a label should
 * be a one-line edit here, not a data migration. Same convention as
 * punches.punch_type ('meal_out') and timecards.booking_status ('pencilled').
 *
 * Must stay in sync with work_days_day_type_check in
 * scripts/sql/migrations/0015_work_day_types.sql.
 */
export const DAY_TYPES = [
  'travel_load_in',
  'load_in',
  'load_in_show',
  'rehearsal',
  'show',
  'load_out_travel',
  'travel',
] as const

export type DayType = typeof DAY_TYPES[number]

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  travel_load_in: 'Travel/Load-in',
  load_in: 'Load-in',
  load_in_show: 'Load-in/Show',
  rehearsal: 'Rehearsal',
  show: 'Show',
  load_out_travel: 'Load-out/Travel',
  travel: 'Travel',
}

export function isDayType(value: unknown): value is DayType {
  return typeof value === 'string' && (DAY_TYPES as readonly string[]).includes(value)
}

/**
 * The label to show, or null when there is nothing to say.
 *
 * Null covers both "nobody has set one yet" and "the database holds a value this
 * build has never heard of" — a row written by a newer version renders as blank
 * rather than crashing, or worse, printing a raw slug into an email to a crew
 * member.
 */
export function dayTypeLabel(value: string | null | undefined): string | null {
  return isDayType(value) ? DAY_TYPE_LABELS[value] : null
}
