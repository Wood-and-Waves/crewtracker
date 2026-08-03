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
// DayScope lived here and is gone (2026-08-03)
// ---------------------------------------------------------------------------
//
// It described which days a call line covered — 'first-last' for riggers,
// 'middle' for a teleprompter operator — as a dropdown beside each line.
//
// The grid replaced it: you tick the days, which is the same idea SHOWN rather
// than described, and the bulk-add panel does it across rooms too. The dropdown
// had in fact already stopped rendering, because it was gated on a `dayCount`
// prop that its only caller never passed. It was dead code with tests.
//
// The one piece of real knowledge in it was that a ONE-DAY show is both the
// first and the last day and must be counted once. That did not get lost — it
// is the de-duplication in addLinesTo/plannedAddCount, and it has its own tests
// there, because "Copy to load in + load out" passes [0, totalDays - 1] which
// on a one-day run is [0, 0].
