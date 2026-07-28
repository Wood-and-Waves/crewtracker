import Link from 'next/link'
import { cn } from '@/lib/cn'
import { todayInZone } from '@/lib/showStatus'
import { byShowAndDate, type ScheduleBooking, type ScheduleShow } from '@/lib/schedule'

// The desktop schedule: one row per show, one column per calendar date.
//
// No 'use client' — this is entirely static markup and CSS. Sticky positioning
// and horizontal scroll need no JavaScript, and keeping it server-rendered means
// the whole grid arrives in the first response.
//
// DENSITY IS THE WHOLE POINT. The screen exists to answer "what does the next
// fortnight look like" in one glance, so the requested window has to FIT — a
// grid you must scroll sideways to read has failed at its only job. Two rules
// follow from that, and both were learned by building the roomy version first:
//
//   * Day columns are `1fr`, not a fixed width, so 14 of them divide the space
//     available instead of overflowing it. There is still a floor, below which
//     the whole grid scrolls rather than becoming illegible.
//   * A cell holds a COUNT, not a cast list. Names at this size cost three lines
//     of row height each and are unreadable anyway; the count is what is being
//     scanned for, and the names are one click away on the show's own day.
//
// THREE CELL STATES, and the middle one is the reason this screen exists:
//   * show runs that day, crew booked      -> the count
//   * show runs that day, NOBODY booked    -> a visible gap, not a blank
//   * show does not run that day           -> blank
// Collapsing the middle case into "blank" would hide exactly the thing a
// scheduler is looking for. An unstaffed show day is a question; a day the show
// isn't running is not.

const NAME_COL = 215
// The floor, not the width — columns are 1fr and expand to fill. It is set by
// the widest thing a column must still show at the LONGEST window: a two-digit
// day number and a three-letter weekday. 28 days at this floor fits a 1280px
// laptop, which is the point at which the 28d button stops lying about what it
// will show you.
const MIN_DAY_COL = 34

function parts(date: string) {
  // Bare 'YYYY-MM-DD' + T00:00:00 = local midnight. Parsing a date-only string
  // gives UTC midnight, which renders as the previous day west of Greenwich —
  // the same trap the dashboard, tracker, reports and PDF all guard against.
  const d = new Date(date + 'T00:00:00')
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: d.getDate(),
    month: d.toLocaleDateString('en-US', { month: 'short' }),
    isWeekend: d.getDay() === 0 || d.getDay() === 6,
  }
}

/** Consecutive dates grouped by month, for the band above the day numbers. */
function monthGroups(dates: string[]) {
  const groups: { label: string; span: number }[] = []
  for (const date of dates) {
    const label = parts(date).month
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.span++
    else groups.push({ label, span: 1 })
  }
  return groups
}

export default function ScheduleGrid({
  shows,
  bookings,
  dates,
}: {
  shows: ScheduleShow[]
  bookings: ScheduleBooking[]
  dates: string[]
}) {
  const cells = byShowAndDate(bookings)
  const gridTemplateColumns = `${NAME_COL}px repeat(${dates.length}, minmax(${MIN_DAY_COL}px, 1fr))`
  const minWidth = NAME_COL + dates.length * MIN_DAY_COL

  // Which columns are "today" for at least one show on screen. Shows in
  // different zones genuinely have different current dates, so this can be two
  // adjacent columns at once — that is correct, not a bug. Each row still marks
  // its own today; this only drives the header.
  const todayDates = new Set(shows.map(s => todayInZone(s.timezone)))

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <div style={{ minWidth }}>
        {/* Month band. Without it a window spanning a boundary reads as one
            long month, and "28, 29, 30, 31, 1, 2" is genuinely ambiguous. */}
        <div className="grid border-b border-line bg-surface-2" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 z-20 border-r border-line bg-surface-2" />
          {monthGroups(dates).map((g, i) => (
            <div
              key={`${g.label}-${i}`}
              style={{ gridColumn: `span ${g.span}` }}
              className="border-r border-line px-2 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted last:border-r-0"
            >
              {g.label}
            </div>
          ))}
        </div>

        {/* Day numbers */}
        <div className="grid border-b border-line bg-surface-2" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 z-20 border-r border-line bg-surface-2 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Show
          </div>
          {dates.map(date => {
            const p = parts(date)
            const isToday = todayDates.has(date)
            return (
              <div
                key={date}
                className={cn(
                  'border-r border-line px-1 pb-1.5 text-center last:border-r-0',
                  p.isWeekend && 'bg-bg',
                )}
              >
                <div className="text-[9px] font-medium uppercase text-muted">{p.weekday}</div>
                <div
                  className={cn(
                    'mx-auto w-6 rounded-pill text-[13px] font-bold leading-5',
                    isToday ? 'bg-accent text-accent-ink' : 'text-ink',
                  )}
                >
                  {p.day}
                </div>
              </div>
            )
          })}
        </div>

        {/* One row per show */}
        {shows.map(show => {
          const today = todayInZone(show.timezone)
          return (
            <div
              key={show.id}
              className="grid border-b border-line last:border-b-0"
              style={{ gridTemplateColumns }}
            >
              <Link
                href={`/dashboard/shows/${show.id}`}
                className="sticky left-0 z-10 border-r border-line bg-surface px-3 py-2 transition-colors hover:bg-surface-2"
              >
                <div className="truncate text-[13px] font-semibold leading-tight text-ink">
                  {show.name}
                </div>
                <div className="truncate text-[11px] leading-tight text-muted">
                  {show.venue || show.cityState || ' '}
                </div>
              </Link>

              {dates.map(date => {
                const dayNumber = show.dayNumbers[date]
                const running = dayNumber !== undefined
                const crew = cells.get(`${show.id}|${date}`) ?? []
                const p = parts(date)
                // Each row marks its OWN today, from its OWN show timezone.
                // There is deliberately no global today column: inventing one is
                // the bug class this project has already shipped twice.
                const isToday = date === today

                if (!running) {
                  return (
                    <div
                      key={date}
                      className={cn(
                        'border-r border-line last:border-r-0',
                        p.isWeekend && 'bg-bg',
                        isToday && 'bg-accent-wash/30',
                      )}
                    />
                  )
                }

                return (
                  <Link
                    key={date}
                    href={`/dashboard/shows/${show.id}?day=${dayNumber}`}
                    title={
                      crew.length === 0
                        ? `${show.name} — day ${dayNumber}, nobody booked`
                        : `${show.name} — day ${dayNumber}: ${crew.map(c => c.crewName).join(', ')}`
                    }
                    className={cn(
                      'flex items-center justify-center border-r border-line py-2.5 transition-colors last:border-r-0 hover:bg-accent-wash',
                      p.isWeekend && 'bg-bg',
                      isToday && 'bg-accent-wash/40',
                    )}
                  >
                    {crew.length === 0 ? (
                      // A running day with nobody on it. Deliberately legible
                      // rather than empty — this is the gap worth spotting. An
                      // open ring reads as "space to fill" against the solid
                      // numerals, and takes the amber the app already uses for
                      // needs-attention rather than the brand accent.
                      <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ot" />
                    ) : (
                      <span className="text-[13px] font-bold text-ink">{crew.length}</span>
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* A count and an open ring are only self-explanatory once someone has
          been told. One line is cheaper than making the cells wordier. */}
      <div className="flex items-center gap-4 border-t border-line px-3 py-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="font-bold text-ink">6</span> crew booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ot" /> show day, nobody booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-accent-wash" /> today
        </span>
      </div>
    </div>
  )
}
