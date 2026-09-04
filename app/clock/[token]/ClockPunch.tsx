'use client'

import { useState } from 'react'
import {
  PUNCH_LABELS, formatPunchTime, nextPunchType, visiblePunchTypes, roundWallTime,
  type Punch, type PunchType,
} from '@/lib/punches'
import type { ClockAssignment } from '@/lib/clockSession'

// Somebody's own day: what they've recorded, and the one button that comes
// next.
//
// The lit-next-key idea is borrowed straight from the tracker (TimecardRow):
// exactly one button is solid, and it is the punch you are actually about to
// make. Everything else is a stamped time. On a phone, in the dark, one obvious
// target beats a grid of equally-weighted options.
//
// The times shown come back from the SERVER after every punch, never from the
// device clock — the server is what decides when a punch happened, so showing
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
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [timeStr, setTimeStr] = useState('')

  // "Now" means now IN THE SHOW'S ZONE, not on this phone — somebody on a
  // Chicago show whose phone is still on Pacific must not pre-fill two hours
  // early. Snapped so the field opens already on the company's grid.
  const nowInZone = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  const defaultTime = roundWallTime(nowInZone, roundingMinutes).timeStr

  async function punch(timecardId: string, type: PunchType, at?: string) {
    setBusy(`${timecardId}:${type}`); setError('')
    try {
      const res = await fetch('/api/clock/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No `at` means now, decided by the server. The date is never sent —
        // the server pins every punch to the work day it resolved from the
        // show's timezone, which is what stops a bookmarked link back-dating.
        body: JSON.stringify({ token, timecardId, punchType: type, at }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? 'That did not save.'); setBusy(null); return }

      setRows(prev => prev.map(r => {
        if (r.timecardId !== timecardId) return r
        const rest = r.punches.filter(p => p.punch_type !== type)
        const added: Punch = { id: `${type}-${body.punchedAt}`, punch_type: type, punched_at: body.punchedAt }
        return { ...r, punches: [...rest, added].sort((a, b) => a.punched_at.localeCompare(b.punched_at)) }
      }))
      setEditing(null)
    } catch {
      setError('No connection. Your punch was NOT saved — try again.')
    }
    setBusy(null)
  }

  return (
    <div>
      <p className="text-center font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
        {showName}{venue ? ` · ${venue}` : ''}
      </p>
      <h1 className="mb-5 mt-1 text-center text-xl font-bold text-ink">{crewName}</h1>

      {error && <p className="mb-3 text-center text-sm text-danger">{error}</p>}

      {rows.map(row => {
        // Same reveal rule as the tracker: meal 2 and 3 stay hidden until meal
        // 1 is used, so a normal day is four buttons, not eight.
        const types = visiblePunchTypes([row.punches])
        const next = nextPunchType(row.punches)

        return (
          <div key={row.timecardId} className="mb-6">
            {/* Only worth naming the room when there is more than one — most
                people work one room a day and the label is just noise. */}
            {rows.length > 1 && (
              <p className="mb-2 border-b-2 border-ink pb-1 font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-ink">
                {row.room}{row.role ? ` · ${row.role}` : ''}
              </p>
            )}

            <div className="border-t-[3px] border-ink">
              {types.map(type => {
                const done = row.punches.find(p => p.punch_type === type)
                const isNext = !done && type === next
                const working = busy === `${row.timecardId}:${type}`

                const editKey = `${row.timecardId}:${type}`
                const open = editing === editKey

                return (
                  <div key={type}>
                    <div className="flex items-center justify-between gap-3 border-b border-line py-3">
                      <span className="text-sm font-semibold uppercase tracking-wide text-ink">
                        {PUNCH_LABELS[type]}
                      </span>
                      {done ? (
                        <span className="font-mono text-base tabular-nums text-ink">
                          {formatPunchTime(done.punched_at, timeZone)}
                        </span>
                      ) : isNext ? (
                        <div className="flex flex-col items-end gap-1">
                          <button
                            onClick={() => punch(row.timecardId, type)}
                            disabled={busy !== null}
                            className="min-w-[7.5rem] bg-accent px-5 py-3 text-sm font-bold uppercase tracking-wide text-accent-ink disabled:opacity-60"
                          >
                            {working ? 'Saving…' : `Tap to ${PUNCH_LABELS[type]}`}
                          </button>
                          {/* The one-tap path stays the headline and still
                              means "now". Picking a time is the exception —
                              somebody who forgot to tap at the door — so it
                              sits underneath as a quiet link rather than
                              turning every punch into a form. */}
                          <button
                            onClick={() => { setEditing(open ? null : editKey); setTimeStr(defaultTime) }}
                            className="text-[11px] font-semibold uppercase tracking-wide text-accent"
                          >
                            {open ? 'Cancel' : 'Different time'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </div>

                    {open && (
                      <div className="flex items-center gap-2 border-b border-line py-3">
                        <input
                          type="time"
                          value={timeStr}
                          // Steps the picker to the company's own grid. The
                          // server snaps it too — step is a hint a browser
                          // will happily let somebody type past, and this
                          // value gets paid.
                          step={roundingMinutes > 1 ? roundingMinutes * 60 : undefined}
                          onChange={e => setTimeStr(e.target.value)}
                          className="flex-1 rounded-field border-2 border-ink bg-surface px-3 py-3 font-mono text-base text-ink"
                        />
                        <button
                          onClick={() => punch(row.timecardId, type, timeStr)}
                          disabled={busy !== null || !timeStr}
                          className="bg-accent px-5 py-3 text-sm font-bold uppercase tracking-wide text-accent-ink disabled:opacity-60"
                        >
                          {working ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Correcting a mistake is the PM's job, and saying so here stops
                somebody hunting for an edit button that does not exist. */}
            <p className="mt-3 text-xs text-muted">
              Tapped something by mistake? Your PM can fix any time on this list.
            </p>
          </div>
        )
      })}

      <p className="mt-6 border-t border-line pt-4 text-center text-xs text-muted">
        Bookmark this page — it’s yours for the whole show.
      </p>
    </div>
  )
}
