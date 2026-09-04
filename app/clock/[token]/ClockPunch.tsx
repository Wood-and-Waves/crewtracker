'use client'

import { useState } from 'react'
import {
  PUNCH_LABELS, formatPunchTime, nextPunchType, visiblePunchTypes,
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
  token, showName, venue, crewName, timeZone, assignments,
}: {
  token: string
  showName: string
  venue: string | null
  crewName: string
  timeZone: string
  assignments: ClockAssignment[]
}) {
  const [rows, setRows] = useState(assignments)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function punch(timecardId: string, type: PunchType) {
    setBusy(`${timecardId}:${type}`); setError('')
    try {
      const res = await fetch('/api/clock/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, timecardId, punchType: type }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? 'That did not save.'); setBusy(null); return }

      setRows(prev => prev.map(r => {
        if (r.timecardId !== timecardId) return r
        const rest = r.punches.filter(p => p.punch_type !== type)
        const added: Punch = { id: `${type}-${body.punchedAt}`, punch_type: type, punched_at: body.punchedAt }
        return { ...r, punches: [...rest, added].sort((a, b) => a.punched_at.localeCompare(b.punched_at)) }
      }))
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

                return (
                  <div key={type} className="flex items-center justify-between gap-3 border-b border-line py-3">
                    <span className="text-sm font-semibold uppercase tracking-wide text-ink">
                      {PUNCH_LABELS[type]}
                    </span>
                    {done ? (
                      <span className="font-mono text-base tabular-nums text-ink">
                        {formatPunchTime(done.punched_at, timeZone)}
                      </span>
                    ) : isNext ? (
                      <button
                        onClick={() => punch(row.timecardId, type)}
                        disabled={busy !== null}
                        className="min-w-[7.5rem] bg-accent px-5 py-3 text-sm font-bold uppercase tracking-wide text-accent-ink disabled:opacity-60"
                      >
                        {working ? 'Saving…' : `Tap to ${PUNCH_LABELS[type]}`}
                      </button>
                    ) : (
                      <span className="text-sm text-muted">—</span>
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
