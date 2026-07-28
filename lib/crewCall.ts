// Describing the size of a crew call in numbers a human recognises.
//
// Plain module, no 'use client': used by the show page and by the handoff API
// route.
//
// WHY THIS EXISTS
// ---------------
// Positions are stored per room PER DAY, because that is what the work is —
// somebody fills the A1 slot on Tuesday, and Wednesday is a separate booking.
// So a five-day show needing twelve people carries SIXTY position rows.
//
// Reporting that raw count told the scheduler "60 positions to fill", which is
// both true and useless: it is not sixty people, and a handoff email announcing
// sixty is alarming enough to make somebody query the show rather than crew it.
//
// The number a scheduler thinks in is HOW MANY PEOPLE, which is the headcount
// on the busiest day — that is how many humans have to be found. The day count
// is the other half of the sentence, and the raw total is kept for anywhere
// that genuinely means shifts.

export type CallRow = { date: string }

export type CallSummary = {
  /** Every position row: people × days. Rarely the right thing to show. */
  total: number
  /** How many days the call covers. */
  dayCount: number
  /** Headcount on the busiest day — how many people must actually be found. */
  peakPerDay: number
  /** Whether every day needs the same number, which changes the wording. */
  uniform: boolean
}

export function summarizeCall(rows: CallRow[]): CallSummary {
  const perDay = new Map<string, number>()
  for (const r of rows) {
    if (!r.date) continue
    perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1)
  }
  const counts = [...perDay.values()]
  return {
    total: rows.length,
    dayCount: perDay.size,
    peakPerDay: counts.length ? Math.max(...counts) : 0,
    // A call that varies by day (riggers on load-in, full complement on show
    // days) cannot be described by a single number without hedging.
    uniform: counts.length > 0 && counts.every(c => c === counts[0]),
  }
}

/**
 * "12 crew across 5 days", or "up to 12 crew across 5 days" when the days
 * differ. Never leads with the position-row count.
 */
export function describeCallSize(summary: CallSummary): string {
  const { peakPerDay, dayCount, uniform } = summary
  if (peakPerDay === 0) return 'no positions yet'

  const people = `${peakPerDay} crew`
  const qualified = uniform ? people : `up to ${people}`
  if (dayCount <= 1) return qualified
  return `${qualified} across ${dayCount} days`
}

// ---------------------------------------------------------------------------
// Which days of a run a call line applies to
// ---------------------------------------------------------------------------
//
// Not every position runs every day, and the shapes are consistent across this
// business: riggers come in for load-in and load-out and are gone in between, a
// teleprompter operator is only there for show days. Making somebody build the
// whole show and then edit two days by hand is the errand the in-line call
// builder exists to remove.

export type DayScope = 'all' | 'first' | 'last' | 'first-last' | 'middle'

export const DAY_SCOPE_LABELS: Record<DayScope, string> = {
  'all': 'Every day',
  'first': 'First day only',
  'last': 'Last day only',
  'first-last': 'First & last day',
  'middle': 'Middle days only',
}

/** Short form for a chip, where "Every day" is the assumed default. */
export function shortScope(scope: DayScope): string | null {
  switch (scope) {
    case 'all': return null
    case 'first': return 'first day'
    case 'last': return 'last day'
    case 'first-last': return 'first & last'
    case 'middle': return 'middle days'
  }
}

/**
 * Whether a line applies to day `index` (0-based) of a `total`-day run.
 *
 * A one-day show is the case worth being careful about: it is both the first
 * and the last day, so 'first-last' must include it ONCE rather than twice, and
 * 'middle' correctly matches nothing.
 */
export function scopeIncludesDay(scope: DayScope, index: number, total: number): boolean {
  switch (scope) {
    case 'all': return true
    case 'first': return index === 0
    case 'last': return index === total - 1
    case 'first-last': return index === 0 || index === total - 1
    case 'middle': return index > 0 && index < total - 1
  }
}

/** How many days of a run a scope actually covers — 0 means the line does nothing. */
export function daysCoveredBy(scope: DayScope, total: number): number {
  let n = 0
  for (let i = 0; i < total; i++) if (scopeIncludesDay(scope, i, total)) n++
  return n
}
