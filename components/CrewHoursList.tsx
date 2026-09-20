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

/**
 * The day's paid hours split into bands: "ST 10 · OT 1".
 *
 * Only rendered when there is something to split — on an ordinary day the
 * straight-time figure IS the number beside it, and printing "ST 8" next to
 * "8" is noise on the one screen that has to stay scannable on a phone.
 *
 * Overtime wears --ot, the token the app already uses for overtime everywhere
 * else; colour is information here, not decoration. Double time shares it
 * rather than inventing a token — the word beside the number is what tells
 * them apart, and a day of DT is already explained by the "Short turnaround"
 * note underneath.
 */
function Bands({ straight, overtime, doubleTime }: { straight: number; overtime: number; doubleTime: number }) {
  if (overtime <= 0 && doubleTime <= 0) return null
  const parts: React.ReactNode[] = []
  if (straight > 0) parts.push(<span key="st">ST {hours(straight)}</span>)
  if (overtime > 0) parts.push(<span key="ot" className="text-ot">OT {hours(overtime)}</span>)
  if (doubleTime > 0) parts.push(<span key="dt" className="text-ot">DT {hours(doubleTime)}</span>)
  return (
    <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted">
      {parts.map((part, i) => (
        <span key={i}>{i > 0 && ' · '}{part}</span>
      ))}
    </span>
  )
}

/** A row that links while the show is live, and is inert once it is over. */
function RowShell({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = 'flex items-start justify-between gap-3 py-3'
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
                    {/* The same detail the texted timesheet carries, in the same
                        words — a day with nothing to add says nothing. */}
                    {d.notes.length > 0 && (
                      <span className="mt-0.5 block text-xs text-muted">{d.notes.join(' · ')}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    {d.hours !== null ? (
                      <>
                        <span className="block font-mono text-lg font-semibold tabular-nums text-ink">{hours(d.hours)}</span>
                        <Bands straight={d.straight} overtime={d.overtime} doubleTime={d.doubleTime} />
                      </>
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

          <div className="mt-3 flex items-baseline justify-end">
            <span className="font-mono text-2xl font-bold tabular-nums text-ink">{hours(summary.totalHours)}</span>
          </div>

          {/* Overtime and double time are the run's totals, and they are PAID
              hours — ceiling-rounded per day, so they will not always equal the
              worked hours above minus a threshold. That is the rule payroll
              runs on, and a friendlier-looking number here would disagree with
              the timesheet and with Reports. */}
          {(summary.overtime > 0 || summary.doubleTime > 0) && (
            <div className="mt-1 flex items-baseline justify-between text-sm text-muted">
              <span>
                {summary.overtime > 0 && `Overtime ${hours(summary.overtime)}`}
                {summary.overtime > 0 && summary.doubleTime > 0 && ' · '}
                {summary.doubleTime > 0 && `Double time ${hours(summary.doubleTime)}`}
              </span>
            </div>
          )}

          {/* THE ROUNDING IS THE COMPANY'S RULE, AND IT IS OWED A SENTENCE.
              A day rounds UP to the next whole hour once it passes the hour
              (Dan, 2026-09-20) — so a 10.5-hour day pays 11, and the number
              here is a half hour more than the punch times printed beside it.
              That gap is visible whether or not it is explained, and it is in
              the crew member's favour, so it is worth saying out loud rather
              than leaving them to wonder which number is wrong. */}
          {summary.anyRounded && (
            <p className="mt-4 border-l-[3px] border-ot py-1 pl-3 text-xs text-muted">
              Your day is paid in whole hours, always rounded up — so a day that runs past the
              hour counts as the next one.
            </p>
          )}

          {summary.anyMissing && (
            <p className="mt-2 border-l-[3px] border-ot py-1 pl-3 text-xs text-muted">
              A day marked Missing was started and never wrapped.
            </p>
          )}

        </>
      )}
    </div>
  )
}
