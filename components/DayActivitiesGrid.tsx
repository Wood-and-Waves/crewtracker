'use client'

import { cn } from '@/lib/cn'
import { ACTIVITIES, ACTIVITY_LABELS, dayLabel, dayActivitiesBgClass, type Activity } from '@/lib/dayActivities'

// One row per day, five toggles, the derived label on the right (Section A of
// the 2026-09-07 show-flow spec). Eight days is forty squares but eight
// decisions — and the Show column reads as a stripe, so the odd day out stands
// out. Replaces eight dropdowns of compound names that could never list every
// combination.
//
// Two callers: New Show holds the value in state until the show exists; Edit
// Show saves each toggle (a verified write) and passes busyKey while it does.
// This component does not know which; it only reports a toggle.

type Row = { key: string; date: string }

// A lit square wears its activity's colour. Load-in and load-out share amber,
// as they do in the derived tint.
const ON: Record<Activity, string> = {
  travel: 'bg-day-travel border-day-travel text-white',
  load_in: 'bg-day-loadin border-day-loadin text-white',
  rehearsal: 'bg-day-rehearsal border-day-rehearsal text-white',
  show: 'bg-day-show border-day-show text-white',
  load_out: 'bg-day-loadin border-day-loadin text-white',
}

// Fixed to en-US so the server and the browser agree (a locale mismatch is a
// hydration warning); the tracker's day strip does the same.
function dayHead(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Columns sized for the WORDS in the header, not just the squares: at 36px
// "Rehearsal" truncated to "REH…" on Dan's first look. Phone widths keep the
// squares tight and let the header wrap.
const COLS = 'grid-cols-[minmax(96px,1fr)_repeat(5,34px)_minmax(110px,1.2fr)] sm:grid-cols-[130px_repeat(5,84px)_minmax(160px,1fr)]'

export default function DayActivitiesGrid({
  rows, value, onToggle, busyKey = null, error,
}: {
  rows: Row[]
  /** Activities per row key. Missing = none. */
  value: Record<string, Activity[]>
  onToggle: (key: string, activity: Activity, next: boolean) => void | Promise<void>
  /** The row being saved right now (Edit Show); its squares are disabled. */
  busyKey?: string | null
  error?: string
}) {
  return (
    <div>
      <div className={cn('grid items-center gap-x-2 border-b-2 border-ink pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted', COLS)}>
        <div>Day</div>
        {ACTIVITIES.map(a => <div key={a} className="text-center leading-tight">{ACTIVITY_LABELS[a]}</div>)}
        <div>Reads as</div>
      </div>
      {rows.map(r => {
        const acts = value[r.key] ?? []
        const label = dayLabel(acts)
        const tint = dayActivitiesBgClass(acts)
        return (
          <div key={r.key} className={cn('grid items-center gap-x-2 border-b border-line py-1.5 last:border-b-[3px] last:border-ink', COLS)}>
            <div className="truncate font-mono text-xs font-semibold uppercase text-muted">{dayHead(r.date)}</div>
            {ACTIVITIES.map(a => {
              const on = acts.includes(a)
              return (
                <button
                  key={a}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${ACTIVITY_LABELS[a]} on ${dayHead(r.date)}`}
                  disabled={busyKey === r.key}
                  onClick={() => onToggle(r.key, a, !on)}
                  className={cn(
                    'mx-auto flex h-7 w-7 items-center justify-center rounded-field border text-sm transition-colors disabled:opacity-50',
                    on ? ON[a] : 'border-line bg-surface-2 text-transparent hover:border-ink',
                  )}
                >
                  ✓
                </button>
              )
            })}
            <div className="min-w-0">
              <div className={cn('h-1.5 w-full', tint ?? 'bg-line')} />
              <div className="mt-1 truncate text-xs text-ink">{label ?? <span className="text-muted">—</span>}</div>
            </div>
          </div>
        )
      })}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <p className="mt-2 text-xs text-muted">
        Optional. Tap what the show is doing each day. Shown on the tracker and beside each date in a crew booking request.
      </p>
    </div>
  )
}
