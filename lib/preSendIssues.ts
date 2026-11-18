// The Final Report's pre-send checks, as data the dialog can link from.
//
// Dan, 2026-11-18, looking at "2 not started — Dan Smith, Clint Serman": "it
// doesn't tell me the days it is having issues with." The checks always knew
// the day — each one is a timecard or a room, and both belong to a work day —
// and threw it away by collapsing to a list of names. So "2 empty rooms —
// Registration" named one room for two problems: the same room, empty on two
// different days.
//
// Each subject now carries its days, grouped into runs ("Days 4–5"), and each
// run links to its first day on the tracker so a missed punch is one tap from
// the warning. Plain module, no 'use client': the Reports page builds these on
// the server and the test imports them.

export type IssueDay = { dayNumber: number; date: string }

export type IssueSubject = {
  name: string
  /** Empty when the subject is not about particular days (crew-entered times). */
  runs: DayRun[]
}

export type PreSendIssue = {
  label: string
  subjects: IssueSubject[]
  /** How many subjects were left off the end of the list. */
  more: number
}

export type DayRun = { from: IssueDay; to: IssueDay }

/** Consecutive day NUMBERS collapse into one run; duplicates are ignored. */
export function groupDayRuns(days: IssueDay[]): DayRun[] {
  const sorted = [...new Map(days.map(d => [d.dayNumber, d])).values()]
    .sort((a, b) => a.dayNumber - b.dayNumber)
  const runs: DayRun[] = []
  for (const d of sorted) {
    const last = runs[runs.length - 1]
    if (last && d.dayNumber === last.to.dayNumber + 1) last.to = d
    else runs.push({ from: d, to: d })
  }
  return runs
}

/** "Mon 16" from a YYYY-MM-DD date, read as the calendar date it names. */
export function shortDay(date: string): string {
  const d = new Date(date.slice(0, 10) + 'T00:00:00Z')
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday} ${d.getUTCDate()}`
}

/** "Day 1 (Mon 16)" or "Days 4–5 (Thu 19 – Fri 20)". */
export function formatDayRun(run: DayRun): string {
  if (run.from.dayNumber === run.to.dayNumber) {
    return `Day ${run.from.dayNumber} (${shortDay(run.from.date)})`
  }
  return `Days ${run.from.dayNumber}–${run.to.dayNumber} (${shortDay(run.from.date)} – ${shortDay(run.to.date)})`
}

/**
 * Group (name, day) pairs into subjects, in order of first appearance, keeping
 * the first `limit` and counting the rest — the same four-name cap the dialog
 * has always had, so a show with forty empty timecards does not become a page.
 */
export function buildSubjects(
  pairs: { name: string; day: IssueDay | null }[],
  limit = 4,
): { subjects: IssueSubject[]; more: number } {
  const byName = new Map<string, IssueDay[]>()
  for (const p of pairs) {
    const days = byName.get(p.name) ?? []
    if (p.day) days.push(p.day)
    byName.set(p.name, days)
  }
  const all = [...byName.entries()].map(([name, days]) => ({ name, runs: groupDayRuns(days) }))
  return { subjects: all.slice(0, limit), more: Math.max(0, all.length - limit) }
}
