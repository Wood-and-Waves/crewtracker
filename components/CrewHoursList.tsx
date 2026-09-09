import Link from 'next/link'
import { BAND, RULE_MAJOR } from '@/lib/panel'
import { cn } from '@/lib/cn'
import type { CrewHours } from '@/lib/crewHours'

// A crew member's own run, in one list. Read-only, hours only, no money.
//
// Server component: it renders numbers somebody else computed and links to the
// day they already have. Nothing here is interactive except those links.
//
// The layout is the crew clock's, scaled for the same phone: the ink BAND
// masthead, generous rows because this is read at arm's length in bad light,
// and RULE_MAJOR closing the list above the total.

function dayLabel(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/** "9.5", "10", never "9.50" — a crew member reads hours, not currency. */
function hours(n: number) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/** A row that links while the show is live, and is inert once it is over. */
function RowShell({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = 'flex items-baseline justify-between gap-3 py-3'
  return href
    ? <Link href={href} className={cn(cls, 'transition-colors hover:text-accent')}>{children}</Link>
    : <div className={cls}>{children}</div>
}

export default function CrewHoursList({
  showName, hours: summary, dayHref, todayHref,
}: {
  showName: string
  hours: CrewHours
  /** Where a row goes: that day's punch grid. NULL once the show is over —
   *  the hours stay readable, but there is nothing left to open. */
  dayHref: ((date: string) => string) | null
  /** Back to punching, or null for the same reason. */
  todayHref: string | null
}) {
  return (
    <div className="mx-auto max-w-lg px-4 pb-16 pt-4">
      <div className={cn(BAND, '-mx-4 px-4 py-3')}>
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] opacity-70">Your hours</p>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight">{showName}</h1>
      </div>

      {/* No toggle once the show is over: there is no punch screen to go back
          to, and a button that leads to "this link has expired" is worse than
          no button. */}
      {todayHref && (
        <div className="mt-4 flex gap-2">
          <Link
            href={todayHref}
            className="flex-1 border-2 border-ink px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-ink"
          >
            Today
          </Link>
          <span className="flex-1 border-2 border-ink bg-ink px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-bg">
            Your hours
          </span>
        </div>
      )}

      {summary.days.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted">You have no days on this show.</p>
      ) : (
        <>
          <ul className={cn('mt-5 divide-y divide-line', RULE_MAJOR)}>
            {summary.days.map(d => (
              <li key={`${d.date}-${d.room}`}>
                {/* The row IS the link while the show is live: tapping a day
                    opens that day's punch grid, the screen they already know.
                    Afterwards it is a plain row — the hours are still worth
                    reading, but nothing can be changed. */}
                <RowShell href={dayHref ? dayHref(d.date) : null}>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-ink">{dayLabel(d.date)}</span>
                    <span className="block truncate text-xs text-muted">
                      {d.label ?? (d.start && d.end ? `${d.start} – ${d.end}` : d.start ? `${d.start} – no wrap yet` : 'Not clocked in')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {d.hours !== null ? (
                      <span className="font-mono text-lg font-semibold tabular-nums text-ink">{hours(d.hours)}</span>
                    ) : d.missing ? (
                      // The half of the question this screen exists for.
                      <span className="text-xs font-semibold uppercase tracking-wide text-ot">Missing</span>
                    ) : (
                      <span className="text-lg text-muted">—</span>
                    )}
                  </span>
                </RowShell>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-sm text-muted">
              {summary.workedDays} {summary.workedDays === 1 ? 'day' : 'days'} worked
            </span>
            <span className="font-mono text-2xl font-bold tabular-nums text-ink">{hours(summary.totalHours)}</span>
          </div>

          {summary.anyMissing && (
            <p className="mt-4 border-l-[3px] border-ot py-1 pl-3 text-xs text-muted">
              A day marked Missing was started and never wrapped.
            </p>
          )}

          {/* No money, ever, on a crew-facing screen — and these are hours as
              recorded, which is not the same as hours as paid: overtime and
              travel are the company's rules, applied later. */}
          <p className="mt-6 text-center text-[11px] leading-relaxed text-muted">
            Hours as recorded, rounded the way your company rounds. Questions go to your PM.
          </p>
        </>
      )}
    </div>
  )
}
