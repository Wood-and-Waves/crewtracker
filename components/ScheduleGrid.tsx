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
// THREE CELL STATES, and the middle one is the reason this screen exists:
//   * show runs that day, crew booked      -> the count
//   * show runs that day, NOBODY booked    -> a visible gap, not a blank
//   * show does not run that day           -> blank
// Collapsing the middle case into "blank" would hide exactly the thing a
// scheduler is looking for. An unstaffed show day is a question; a day the show
// isn't running is not.

const NAME_COL = 240
const DAY_COL = 108

function dayHeader(date: string) {
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

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] || full
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
  const gridTemplateColumns = `${NAME_COL}px repeat(${dates.length}, minmax(${DAY_COL}px, 1fr))`

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <div className="min-w-max">
        {/* Header */}
        <div className="grid border-b border-line bg-surface-2" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 z-20 border-r border-line bg-surface-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Show
          </div>
          {dates.map((date, i) => {
            const h = dayHeader(date)
            // Label the month on the first column and whenever it changes, so a
            // window spanning a month boundary doesn't read as one long month.
            const showMonth = i === 0 || dayHeader(dates[i - 1]).month !== h.month
            return (
              <div
                key={date}
                className={cn(
                  'border-r border-line px-2 py-2 text-center last:border-r-0',
                  h.isWeekend && 'bg-bg',
                )}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {showMonth ? `${h.month} ` : ''}{h.weekday}
                </div>
                <div className="text-sm font-bold text-ink">{h.day}</div>
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
                className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="truncate text-sm font-semibold text-ink">{show.name}</div>
                <div className="truncate text-xs text-muted">
                  {show.venue || show.cityState || ' '}
                </div>
              </Link>

              {dates.map(date => {
                const dayNumber = show.dayNumbers[date]
                const running = dayNumber !== undefined
                const crew = cells.get(`${show.id}|${date}`) ?? []
                const h = dayHeader(date)
                // Each row marks its OWN today. Shows in different timezones
                // genuinely have different current dates and there is no single
                // right answer, so there is deliberately no global today column.
                const isToday = date === today

                if (!running) {
                  return (
                    <div
                      key={date}
                      className={cn(
                        'border-r border-line last:border-r-0',
                        h.isWeekend && 'bg-bg',
                        isToday && 'border-l-2 border-l-accent',
                      )}
                    />
                  )
                }

                return (
                  <Link
                    key={date}
                    href={`/dashboard/shows/${show.id}?day=${dayNumber}`}
                    className={cn(
                      'group border-r border-line px-2 py-2 transition-colors last:border-r-0 hover:bg-accent-wash',
                      h.isWeekend && 'bg-bg',
                      isToday && 'border-l-2 border-l-accent',
                    )}
                  >
                    {crew.length === 0 ? (
                      // A running day with nobody on it. Deliberately legible
                      // rather than empty — this is the gap worth spotting.
                      <div className="flex h-full items-center justify-center">
                        <span className="rounded-pill border border-dashed border-line px-2 py-0.5 text-[10px] font-medium text-muted">
                          none
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="text-center text-sm font-bold text-ink">{crew.length}</div>
                        <div className="mt-0.5 space-y-px text-center">
                          {crew.slice(0, 2).map(c => (
                            <div key={c.timecardId} className="truncate text-[10px] leading-tight text-muted">
                              {firstName(c.crewName)}
                            </div>
                          ))}
                          {crew.length > 2 && (
                            <div className="text-[10px] leading-tight text-muted">
                              +{crew.length - 2}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
