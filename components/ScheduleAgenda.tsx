import Link from 'next/link'
import { cn } from '@/lib/cn'
import Chip from '@/components/ui/Chip'
import { todayInZone } from '@/lib/showStatus'
import { byShowAndDate, coverageFor, type ScheduleBooking, type ScheduleShow } from '@/lib/schedule'

// The schedule below 1024px: a vertical agenda, one section per date.
//
// Not a narrow grid. A day-cell grid needs ~100px per column to stay legible, so
// at 375px it fits three days — which is worse than useless for a screen whose
// job is showing a stretch of time. The app already restructures rather than
// shrinks (see CLAUDE.md on responsive nav), so mobile gets a different shape
// answering the same question: scroll down through days rather than across.
//
// Empty days are skipped entirely here, unlike the desktop grid where a blank
// column still carries meaning by sitting between two full ones. In a vertical
// list a run of "nothing on" sections is just an obstacle between the user and
// the next real day.

function sectionHeader(date: string) {
  const d = new Date(date + 'T00:00:00')
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    rest: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    isWeekend: d.getDay() === 0 || d.getDay() === 6,
  }
}

export default function ScheduleAgenda({
  shows,
  bookings,
  dates,
}: {
  shows: ScheduleShow[]
  bookings: ScheduleBooking[]
  dates: string[]
}) {
  const cells = byShowAndDate(bookings)

  const days = dates
    .map(date => ({
      date,
      running: shows.filter(s => s.dayNumbers[date] !== undefined),
    }))
    .filter(d => d.running.length > 0)

  if (days.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted">
        Nothing scheduled in this window.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {days.map(({ date, running }) => {
        const h = sectionHeader(date)
        return (
          <section key={date}>
            <div className="mb-2 flex items-baseline gap-2 px-1">
              <h2 className={cn('text-sm font-bold', h.isWeekend ? 'text-muted' : 'text-ink')}>
                {h.weekday}
              </h2>
              <span className="text-xs text-muted">{h.rest}</span>
              {/* Per-show timezone, so "today" is marked if it is today for ANY
                  show running that date rather than for the reader's browser. */}
              {running.some(s => todayInZone(s.timezone) === date) && (
                <Chip tone="live">Today</Chip>
              )}
            </div>

            <div className="space-y-2">
              {running.map(show => {
                const crew = cells.get(`${show.id}|${date}`) ?? []
                const cover = coverageFor(show, date, crew)
                return (
                  <Link
                    key={show.id}
                    href={`/dashboard/shows/${show.id}?day=${show.dayNumbers[date]}`}
                    className="block rounded-card border border-line bg-surface px-4 py-3 transition-colors active:bg-surface-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">{show.name}</div>
                        {(show.venue || show.cityState) && (
                          <div className="truncate text-xs text-muted">
                            {show.venue || show.cityState}
                          </div>
                        )}
                      </div>
                      {cover.crewCount === 0
                        ? <Chip tone="ot">Nobody booked</Chip>
                        : cover.roomsUnstaffed > 0
                          ? <Chip tone="ot">{cover.crewCount} crew</Chip>
                          : <Chip tone="neutral">{cover.crewCount} crew</Chip>}
                    </div>

                    {/* Coverage, not a cast list. A truncated sample of names
                        implies a precision it cannot deliver, and the real
                        question here is whether the day is covered. */}
                    {cover.roomsTotal > 0 && (
                      <div className="mt-2 text-xs text-muted">
                        {cover.roomsStaffed} of {cover.roomsTotal} room
                        {cover.roomsTotal === 1 ? '' : 's'} staffed
                        {cover.roomsUnstaffed > 0 && (
                          <span className="text-ot">
                            {' '}· {cover.roomsUnstaffed} still to fill
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
