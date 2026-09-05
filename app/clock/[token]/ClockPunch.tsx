'use client'

import { useState } from 'react'
import {
  PUNCH_LABELS, formatPunchTime, nextPunchType, visiblePunchTypes, roundWallTime,
  type Punch, type PunchType,
} from '@/lib/punches'
import { BAND, RULE_MAJOR } from '@/lib/panel'
import { cn } from '@/lib/cn'
import type { ClockAssignment } from '@/lib/clockSession'

// Somebody's own day. Built to read as the tracker, because it is the same job.
//
// THE GESTURE IS THE TRACKER'S GESTURE: tap a punch cell, an editor opens with
// the time pre-filled, Save. Identical to TimeEntryModal. The first version
// invented its own — a "Tap to Start" button for now plus a separate "Different
// time" link — which Dan called unintuitive, and rightly: two affordances for
// one action is a fork, not a shortcut.
//
// THE LAYOUT IS THE TRACKER'S LAYOUT: an ink BAND masthead, then the same
// 3-across grid of chunky punch cells the mobile tracker uses, closed by a
// RULE_MAJOR. Scaled UP from TimecardRow's h-12, because there a cell is one of
// fifty on a roster and here the whole phone serves one person — Dan's first
// look at full-width rows was "a little small to read".
//
// The one deliberate difference from TimeEntryModal: no DATE field. The server
// pins every punch to the work day it resolved from the show's timezone, which
// is what stops a bookmarked link reaching another day.
//
// Times shown come back from the SERVER after every punch, never from the
// device clock — the server decides the instant and rounds it, so showing
// anything else would be a lie the moment the two disagree.

export default function ClockPunch({
  token, showName, venue, crewName, timeZone, roundingMinutes, assignments,
}: {
  token: string
  showName: string
  venue: string | null
  crewName: string
  timeZone: string
  /** The company's punch grid, from organizations.timecard_rounding_minutes. */
  roundingMinutes: number
  assignments: ClockAssignment[]
}) {
  const [rows, setRows] = useState(assignments)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ timecardId: string; type: PunchType } | null>(null)
  const [timeStr, setTimeStr] = useState('')

  const wallNow = (d: Date) => new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)

  function open(timecardId: string, type: PunchType, existing?: Punch) {
    setError('')
    // A new punch opens at "now" IN THE SHOW'S ZONE — somebody on a Chicago
    // show whose phone is still on Pacific must not pre-fill two hours early —
    // already rounded, so the field shows the time that will actually be saved
    // rather than one the server then moves.
    setTimeStr(existing
      ? wallNow(new Date(existing.punched_at))
      : roundWallTime(wallNow(new Date()), roundingMinutes).timeStr)
    setEditing({ timecardId, type })
  }

  async function save() {
    if (!editing) return
    const { timecardId, type } = editing
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/clock/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only a wall-clock time is sent; the date is never the caller's to
        // choose. See the header.
        body: JSON.stringify({ token, timecardId, punchType: type, at: timeStr }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? 'That did not save.'); setBusy(false); return }

      setRows(prev => prev.map(r => {
        if (r.timecardId !== timecardId) return r
        const rest = r.punches.filter(p => p.punch_type !== type)
        const added: Punch = {
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
      {/* ONE solid band per screen: this person. Room strips below are light,
          the same rule the shows list follows. */}
      <div className={cn(BAND, 'px-4 py-3')}>
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] opacity-80">
          {showName}{venue ? ` · ${venue}` : ''}
        </p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight">{crewName}</h1>
      </div>

      {!editing && error && (
        <p className="border-b border-line px-4 py-3 text-center text-sm text-danger">{error}</p>
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

            <div className={RULE_MAJOR}>
              <div className="grid grid-cols-3 gap-2 p-3">
                {types.map(type => {
                  const done = row.punches.find(p => p.punch_type === type)
                  const isNext = !done && type === next
                  // A punch the PM entered is theirs to change, not this
                  // person's — the server refuses it either way, so the cell
                  // must not look tappable and then fail.
                  const pmEntered = !!done && done.source !== 'crew'
                  const tappable = !pmEntered && (isNext || !!done)

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
                        // The lit next key, straight off the tracker: exactly
                        // one solid Crew Blue cell is the step you are on.
                        isNext && 'bg-accent text-accent-ink',
                        !done && !isNext && 'bg-surface-3 text-muted',
                      )}
                    >
                      <span className={cn(
                        'block text-[11px] font-semibold uppercase leading-none tracking-wide',
                        done ? 'text-muted' : isNext ? 'text-accent-ink opacity-90' : 'text-muted',
                      )}>
                        {PUNCH_LABELS[type]}
                      </span>

                      {done ? (
                        <>
                          <span className="block font-mono text-2xl font-bold leading-none">
                            {formatPunchTime(done.punched_at, timeZone)}
                          </span>
                          {/* Says why the cell does nothing, rather than
                              leaving a dead tap to be discovered. */}
                          {pmEntered && (
                            <span className="block text-[10px] uppercase leading-none tracking-wide text-muted">
                              set by PM
                            </span>
                          )}
                        </>
                      ) : isNext ? (
                        <span className="block text-xl font-bold uppercase leading-none">Tap</span>
                      ) : (
                        <span className="block text-xl font-bold leading-none">—</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
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
              {roundingMinutes > 1
                ? `Recorded in ${roundingMinutes}-minute steps, always rounded up.`
                : 'Check the time before you save.'}
            </p>

            <input
              type="time"
              value={timeStr}
              step={roundingMinutes > 1 ? roundingMinutes * 60 : undefined}
              onChange={e => setTimeStr(e.target.value)}
              className="rounded-field mb-4 w-full border border-line bg-surface-2 px-4 py-4 text-center font-mono text-3xl font-bold text-ink outline-none focus:border-accent"
            />

            {error && <p className="mb-3 text-sm text-danger">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { setEditing(null); setError('') }}
                className="flex-1 border-2 border-ink py-4 text-sm font-bold uppercase tracking-wide text-ink"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy || !timeStr}
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
