// Explicit conversions between wall-clock values and instants.
//
// Plain module (no 'use client') so it is safe to import from client
// components AND Server Components — see CLAUDE.md "Past incidents" on the
// client/server export rule.
//
// Why this exists: punches are stored as UTC instants (`punches.punched_at`)
// but entered and displayed as wall-clock times in the SHOW's timezone, which
// is often not the browser's. `new Date('2026-07-25T14:00:00')` silently uses
// the browser's zone, so entering a punch from Chicago for a New York show
// saved it an hour off. Every wall-clock <-> instant conversion must name the
// timezone it means; that's what these helpers force.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

/** What `instant` reads on the wall clock in `timeZone`. */
function zonedParts(instant: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  const out: Record<string, string> = {}
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = p.value
  }

  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // Some runtimes render midnight as "24" under hour12: false.
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
  }
}

/** How far ahead of UTC `timeZone` sits at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - instant.getTime()
}

/**
 * The UTC instant that a wall-clock date + time refers to in `timeZone`.
 *
 * `dateStr` is 'YYYY-MM-DD', `timeStr` is 'HH:mm' — the two values an
 * <input type="date"> and <input type="time"> pair produces.
 *
 * DST handling: an ambiguous time (the repeated hour when clocks go back)
 * resolves to the FIRST occurrence; a non-existent time (the skipped hour when
 * clocks go forward) resolves FORWARD past the gap. That matches Temporal's
 * 'compatible' disambiguation.
 */
export function zonedWallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  // Read the wall-clock value as though it were UTC, then back out the zone's
  // real offset at that moment.
  const guess = new Date(`${dateStr}T${timeStr}:00Z`)
  if (Number.isNaN(guess.getTime())) return guess

  const offset1 = offsetMs(guess, timeZone)
  const first = new Date(guess.getTime() - offset1)

  const offset2 = offsetMs(first, timeZone)
  if (offset2 === offset1) return first

  // Straddled a DST transition. Re-resolve with the offset actually in force;
  // if that lands back inside the gap, keep `first`, which resolves forward.
  const second = new Date(guess.getTime() - offset2)
  return offsetMs(second, timeZone) === offset2 ? second : first
}

/**
 * The wall-clock date and time an instant reads in `timeZone`, shaped for
 * <input type="date"> and <input type="time">.
 */
export function utcToZonedParts(
  instant: Date,
  timeZone: string,
): { dateStr: string; timeStr: string } {
  const p = zonedParts(instant, timeZone)
  return {
    dateStr: `${pad4(p.year)}-${pad(p.month)}-${pad(p.day)}`,
    timeStr: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

/**
 * `n` days after (or before, if negative) a bare calendar date.
 *
 * Bare date string in, bare date string out — a Date never escapes, which is
 * the whole point. The schedule's columns are calendar dates, and the moment
 * one becomes a Date it acquires a timezone it has no business having.
 *
 * The arithmetic runs in UTC deliberately. UTC has no DST, so "add one day" is
 * always exactly 86,400,000ms and can never land on a skipped or repeated hour.
 * Doing the same sum in local time silently produces a 23- or 25-hour day twice
 * a year, which is how a calendar ends up with a duplicated or missing column.
 */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000)
  return `${pad4(t.getUTCFullYear())}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** `count` consecutive calendar dates starting at `start`, as 'YYYY-MM-DD'. */
export function dateRange(start: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(start, i))
}

/**
 * 'YYYY-MM-DD' read from a Date's LOCAL parts.
 *
 * For calendar-date arithmetic (generating work days), where the Date was
 * built at local midnight and stepped with setDate(). Reading the UTC date off
 * such a value — `toISOString().slice(0, 10)` — shifts a day for any browser
 * ahead of UTC.
 */
export function localDateStr(d: Date): string {
  return `${pad4(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
