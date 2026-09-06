'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PUNCH_LABELS, formatPunchTime, nextPunchType, visiblePunchTypes,
  isEligibleForBatch, roundWallTime,
  type Punch, type PunchType,
} from '@/lib/punches'
import { BAND, RULE_MAJOR } from '@/lib/panel'
import { cn } from '@/lib/cn'
import Select from '@/components/ui/Select'
import type { ClockAssignment } from '@/lib/clockSession'

// Somebody's own day. Built to read as the tracker, because it is the same job.
//
// THE GESTURE IS THE TRACKER'S: tap a punch cell, an editor opens with the time
// pre-filled, Save. THE LAYOUT IS THE TRACKER'S: ink BAND masthead, the mobile
// tracker's 3-across grid of chunky cells, RULE_MAJOR closing, scaled up
// because the whole phone serves one person.
//
// WHICH CELLS ARE TAPPABLE is `isEligibleForBatch` — the app's existing rule,
// and the SAME one the server enforces, so the two can never disagree. That
// matters: an earlier version only let you tap the single `nextPunchType`,
// which meant Wrap stayed dead until every meal had been filled in. Plenty of
// days have no second meal (Dan, 2026-09-05: "We don't always have M2"), and a
// crew member cannot go home. Eligibility says Wrap needs only a Start, so
// Wrap is now live from the moment the day begins.
//
// `next` survives purely as the VISUAL lit key — one solid Crew Blue cell
// showing the expected step. Other legal cells sit in the ghost register,
// exactly the three-register treatment TimecardRow uses.

export default function ClockPunch({
  token, showName, venue, crewName, timeZone, roundingMinutes,
  selectedDate, today, days, assignments,
}: {
  token: string
  showName: string
  venue: string | null
  crewName: string
  timeZone: string
  /** The company's punch grid, from organizations.timecard_rounding_minutes. */
  roundingMinutes: number
  /** The show day being displayed, YYYY-MM-DD. */
  selectedDate: string
  /** Today in the SHOW's zone, so "Today" can be labelled as such. */
  today: string
  /** Every work day of the show, ascending — the arrows walk this. */
  days: string[]
  assignments: ClockAssignment[]
}) {
  const router = useRouter()
  const [rows, setRows] = useState(assignments)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ timecardId: string; type: PunchType } | null>(null)
  const [hh, setHh] = useState('09')   // 24-hour internally; the UI shows 12-hour
  const [mm, setMm] = useState('00')

  // The punch the editor is open on, if it already exists — decides whether
  // Clear is offered.
  const editingPunch = editing
    ? rows.find(r => r.timecardId === editing.timecardId)
        ?.punches.find(p => p.punch_type === editing.type)
    : undefined

  const dayIndex = days.indexOf(selectedDate)
  const prevDay = dayIndex > 0 ? days[dayIndex - 1] : null
  const nextDay = dayIndex >= 0 && dayIndex < days.length - 1 ? days[dayIndex + 1] : null

  // Parsed as a plain date, then formatted in the SHOW's zone via a UTC noon
  // anchor — a bare `new Date('2026-09-05')` is midnight UTC, which is the
  // previous day anywhere west of Greenwich and would label every day wrong.
  const dayLabel = new Date(`${selectedDate}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })

  const wallNow = (d: Date) => new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)

  // Minutes offered ON the company's grid only — the native time picker's
  // `step` is a hint iOS ignores, and this is the value that gets paid.
  const step = roundingMinutes > 1 ? roundingMinutes : 1
  const minuteOptions = Array.from({ length: Math.ceil(60 / step) }, (_, i) => {
    const v = String(i * step).padStart(2, '0')
    return { value: v, label: v }
  })
  const hourOptions = Array.from({ length: 24 }, (_, h) => {
    const v = String(h).padStart(2, '0')
    const h12 = h % 12 === 0 ? 12 : h % 12
    return { value: v, label: `${h12} ${h < 12 ? 'AM' : 'PM'}` }
  })

  function open(timecardId: string, type: PunchType, existing?: Punch) {
    setError('')
    // A new punch opens at "now" IN THE SHOW'S ZONE — somebody on a Chicago
    // show whose phone is still on Pacific must not pre-fill two hours early —
    // already rounded, so the field shows the time that will actually be saved.
    const wall = existing
      ? wallNow(new Date(existing.punched_at))
      : roundWallTime(wallNow(new Date()), roundingMinutes).timeStr
    const [h, m] = wall.split(':')
    setHh(h)
    // An existing off-grid time (a PM's exact minute, or a punch from before
    // the org had a grid) is snapped to the nearest offered option rather than
    // left unselectable.
    setMm(minuteOptions.some(o => o.value === m)
      ? m
      : minuteOptions.reduce((best, o) =>
          Math.abs(+o.value - +m) < Math.abs(+best.value - +m) ? o : best, minuteOptions[0]).value)
    setEditing({ timecardId, type })
  }

  function goToDay(date: string) {
    // A full navigation, not client state: the server owns which day this is
    // and what is on it, so it re-resolves everything.
    router.push(`?d=${date}`)
  }

  /** Remove a punch this person entered themselves. */
  async function clearPunch() {
    if (!editing) return
    const { timecardId, type } = editing
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/clock/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, timecardId, punchType: type, clear: true }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? 'That did not clear.'); setBusy(false); return }
      setRows(prev => prev.map(r => r.timecardId !== timecardId ? r
        : { ...r, punches: r.punches.filter(p => p.punch_type !== type) }))
      setEditing(null)
    } catch {
      setError('No connection. Nothing was cleared — try again.')
    }
    setBusy(false)
  }

  async function save() {
    if (!editing) return
    const { timecardId, type } = editing
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/clock/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only a wall-clock time is sent. The DATE comes from the timecard,
        // server-side — see the route header.
        body: JSON.stringify({ token, timecardId, punchType: type, at: `${hh}:${mm}` }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? 'That did not save.'); setBusy(false); return }

      setRows(prev => prev.map(r => {
        if (r.timecardId !== timecardId) return r
        const rest = r.punches.filter(p => p.punch_type !== type)
        const added: Punch & { source: 'staff' | 'crew' } = {
          id: `${type}-${body.punchedAt}`, punch_type: type,
          punched_at: body.punchedAt, source: 'crew',
        }
        return { ...r, punches: [...rest, added].sort((a, b) => a.punched_at.localeCompare(b.punched_at)) }
      }))
      setEditing(null)
    } catch {
      setError('No connection. Your punch was NOT saved — try again.')
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto w-full max-w-xl pb-10">
      {/* ONE solid band per screen: this person. */}
      <div className={cn(BAND, 'px-4 py-3')}>
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] opacity-80">
          {showName}{venue ? ` · ${venue}` : ''}
        </p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight">{crewName}</h1>
      </div>

      {/* Day nav. A light strip under the band, the same weight a data table's
          column header gets — two solid bands stacked is the top-heavy look
          Dan called out on the list screens. */}
      <div className="flex items-stretch border-b-2 border-ink bg-surface-2">
        <button
          onClick={() => prevDay && goToDay(prevDay)}
          disabled={!prevDay}
          aria-label="Previous day"
          className="px-5 py-3 text-2xl font-bold leading-none text-ink disabled:opacity-25"
        >
          ‹
        </button>
        <div className="flex flex-1 flex-col items-center justify-center py-2">
          <span className="font-display text-base font-bold uppercase tracking-wide text-ink">
            {dayLabel}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-muted">
            {selectedDate === today
              ? 'Today'
              : `Day ${dayIndex + 1} of ${days.length}`}
          </span>
        </div>
        <button
          onClick={() => nextDay && goToDay(nextDay)}
          disabled={!nextDay}
          aria-label="Next day"
          className="px-5 py-3 text-2xl font-bold leading-none text-ink disabled:opacity-25"
        >
          ›
        </button>
      </div>

      {!editing && error && (
        <p className="border-b border-line px-4 py-3 text-center text-sm text-danger">{error}</p>
      )}

      {rows.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted">
          You&apos;re not on the call this day. Use the arrows to find your day.
        </p>
      )}

      {rows.map(row => {
        // Same reveal rule as the tracker: meal 2 and 3 stay hidden until meal 1
        // is used, so a normal day is four cells, not eight.
        const types = visiblePunchTypes([row.punches])
        const next = nextPunchType(row.punches)

        return (
          <section key={row.timecardId} className="mb-8">
            {rows.length > 1 && (
              <div className="border-b-2 border-ink bg-surface-2 px-4 py-2">
                <h2 className="font-display text-base font-bold uppercase tracking-wide text-ink">
                  {row.room}{row.role ? ` · ${row.role}` : ''}
                </h2>
              </div>
            )}

            {/* A travel day has no punches to make, and every cell would be
                disabled — six dead squares reading "—" with nothing saying
                why. The desktop tracker replaces the punch strip with a
                banner (TimecardRow.tsx); same treatment here, scaled up.
                Note this is plain is_travel_day only: travel_in/out are
                HYBRID days that are additive to hours actually worked, so
                those still punch normally. */}
            {row.absence ? (
              // Booked but not worked (0027). Same shape as the travel banner
              // below; the route refuses a punch on such a day regardless.
              <div className={RULE_MAJOR}>
                <div className="p-3">
                  <div className="rounded-field bg-surface-3 py-8 text-center">
                    <p className="font-display text-xl font-bold uppercase tracking-wide text-muted">
                      {row.absence === 'cancelled' ? 'Cancelled' : 'No-show'}
                    </p>
                    <p className="mt-1 px-6 text-sm text-muted">
                      {row.absence === 'cancelled'
                        ? 'This day was cancelled, so there is nothing to clock. Talk to your PM if that is wrong.'
                        : 'This day is marked as a no-show. Talk to your PM if that is wrong.'}
                    </p>
                  </div>
                </div>
              </div>
            ) : row.isTravelDay ? (
              <div className={RULE_MAJOR}>
                <div className="p-3">
                  <div className="rounded-field bg-accent/10 py-8 text-center">
                    <p className="font-display text-xl font-bold uppercase tracking-wide text-accent">
                      ✈ Travel Day
                    </p>
                    <p className="mt-1 px-6 text-sm text-muted">
                      Nothing to clock today — your hours are handled by your PM.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
            <div className={RULE_MAJOR}>
              <div className="grid grid-cols-3 gap-2 p-3">
                {types.map(type => {
                  const done = row.punches.find(p => p.punch_type === type)
                  const isNext = !done && type === next
                  // A punch the PM entered is theirs to change, not this
                  // person's — the server refuses it either way, so the cell
                  // must not look tappable and then fail.
                  const pmEntered = !!done && done.source !== 'crew'
                  // The app's own eligibility rule, matching the server. Wrap
                  // needs only a Start, so a day with no second meal still ends.
                  const legal = isEligibleForBatch(row.punches, row.isTravelDay, type, row.absence)
                  const tappable = !pmEntered && (legal || !!done)
                  const available = !done && legal && !isNext

                  return (
                    <button
                      key={type}
                      onClick={() => tappable && open(row.timecardId, type, done)}
                      disabled={!tappable}
                      title={pmEntered ? 'Your PM set this time — ask them to change it' : undefined}
                      className={cn(
                        'rounded-field flex h-24 flex-col items-center justify-center gap-1',
                        'px-1 text-center tabular-nums whitespace-nowrap transition-colors',
                        done && 'bg-surface-2 text-ink',
                        isNext && 'bg-accent text-accent-ink',
                        // Legal but not the expected next step: the ghost
                        // register, so Wrap reads as reachable without
                        // competing with the lit key.
                        available && 'border-2 border-accent/45 bg-transparent text-accent',
                        !done && !legal && 'bg-surface-3 text-muted',
                      )}
                    >
                      <span className={cn(
                        'block text-[11px] font-semibold uppercase leading-none tracking-wide',
                        isNext ? 'text-accent-ink opacity-90' : available ? 'text-accent' : 'text-muted',
                      )}>
                        {PUNCH_LABELS[type]}
                      </span>

                      {done ? (
                        <>
                          <span className="block font-mono text-2xl font-bold leading-none">
                            {formatPunchTime(done.punched_at, timeZone)}
                          </span>
                          {pmEntered && (
                            <span className="block text-[10px] uppercase leading-none tracking-wide text-muted">
                              set by PM
                            </span>
                          )}
                        </>
                      ) : legal ? (
                        <span className="block text-xl font-bold uppercase leading-none">Tap</span>
                      ) : (
                        <span className="block text-xl font-bold leading-none">—</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            )}
          </section>
        )
      })}

      <p className="px-4 text-center text-xs text-muted">
        Bookmark this page — it&apos;s yours for the whole show.
      </p>

      {/* The tracker's editor, minus the date field. A true overlay, which is
          one of the two things Open Paper still lets keep a box. */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge">
            <h2 className="font-display text-2xl font-bold uppercase text-ink">
              {PUNCH_LABELS[editing.type]}
            </h2>
            <p className="mb-4 mt-1 text-xs text-muted">
              {dayLabel}
              {roundingMinutes > 1 && ` · ${roundingMinutes}-minute steps`}
            </p>

            {/* Two Selects rather than input[type=time]. The native picker
                ignores `step` on iOS and offers every minute, which is exactly
                what Dan asked not to happen — and it was also the control that
                overran this dialog. Offering only grid minutes makes the rule
                structural instead of a correction applied after the fact. */}
            <div className="mb-4 flex items-center gap-2">
              <Select
                value={hh}
                options={hourOptions}
                onChange={setHh}
                ariaLabel="Hour"
                className="flex-1 min-w-0"
              />
              <span className="font-mono text-xl font-bold text-ink">:</span>
              <Select
                value={mm}
                options={minuteOptions}
                onChange={setMm}
                ariaLabel="Minute"
                className="flex-1 min-w-0"
              />
            </div>

            {error && <p className="mb-3 text-sm text-danger">{error}</p>}

            {/* Only for a punch they entered themselves — the server refuses
                a PM's either way, so offering it would be a button that
                fails. Sits on its own row BELOW Cancel/Save rather than
                beside them: a destructive action next to the primary one is
                a misclick waiting to happen on a phone. */}
            {editingPunch?.source === 'crew' && (
              <button
                onClick={clearPunch}
                disabled={busy}
                className="mb-3 w-full border-2 border-danger py-3 text-sm font-bold uppercase tracking-wide text-danger disabled:opacity-60"
              >
                Clear this punch
              </button>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setEditing(null); setError('') }}
                className="flex-1 border-2 border-ink py-4 text-sm font-bold uppercase tracking-wide text-ink"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 bg-accent py-4 text-sm font-bold uppercase tracking-wide text-accent-ink disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
