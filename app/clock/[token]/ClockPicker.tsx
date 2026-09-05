'use client'

import { useState } from 'react'
import { BAND, RULE_MAJOR } from '@/lib/panel'
import { cn } from '@/lib/cn'

// The venue-QR path: which room, then which name.
//
// Two taps rather than one long list, because a big show is fifty names and
// because a room is the thing somebody standing in it can answer without
// thinking. Picking a name trades this shared code for that person's own link
// and sends them there, so they can bookmark it and never see this screen
// again.
//
// Wears the same ink BAND and 3px closing rule as the punch screen and the
// tracker — same job, same clothes.

type Roster = { room: string; people: { crewMemberId: string; name: string }[] }[]

export default function ClockPicker({
  token, showName, venue, roster,
}: {
  token: string
  showName: string
  venue: string | null
  roster: Roster
}) {
  // A single-room show has nothing to choose, so skip straight to the names.
  const [room, setRoom] = useState<string | null>(roster.length === 1 ? roster[0].room : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const people = roster.find(r => r.room === room)?.people ?? []

  async function pick(crewMemberId: string) {
    setBusy(crewMemberId); setError('')
    try {
      const res = await fetch('/api/clock/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, crewMemberId }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? 'Something went wrong.'); setBusy(null); return }
      // Replace rather than push: the shared code should not sit in this
      // person's back button, where the next person to borrow the phone finds it.
      window.location.replace(`/clock/${body.token}`)
    } catch {
      setError('No connection. Try again in a moment.')
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl pb-10">
      <div className={cn(BAND, 'px-4 py-3')}>
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] opacity-80">
          Clock in &amp; out{venue ? ` · ${venue}` : ''}
        </p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight">{showName}</h1>
      </div>

      {error && <p className="border-b border-line px-4 py-3 text-center text-sm text-danger">{error}</p>}

      {!room ? (
        <section>
          <div className="border-b-2 border-ink bg-surface-2 px-4 py-2">
            <h2 className="font-display text-base font-bold uppercase tracking-wide text-ink">
              Which room are you in?
            </h2>
          </div>
          <div className={RULE_MAJOR}>
            {roster.map(r => (
              <button
                key={r.room}
                onClick={() => setRoom(r.room)}
                // py-5: tapped with a thumb, in the dark, by somebody carrying
                // a case. The tracker's own touch targets set the floor here.
                className="flex w-full items-center justify-between border-b border-line px-4 py-5 text-left last:border-b-0"
              >
                <span className="text-xl font-semibold text-ink">{r.room}</span>
                <span className="text-sm text-muted">
                  {r.people.length} {r.people.length === 1 ? 'person' : 'people'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section>
          <div className="flex items-center justify-between border-b-2 border-ink bg-surface-2 px-4 py-2">
            <h2 className="font-display text-base font-bold uppercase tracking-wide text-ink">
              Find your name
            </h2>
            {roster.length > 1 && (
              <button onClick={() => setRoom(null)} className="text-xs font-bold uppercase tracking-wide text-accent">
                Change room
              </button>
            )}
          </div>
          <div className={RULE_MAJOR}>
            {people.map(p => (
              <button
                key={p.crewMemberId}
                onClick={() => pick(p.crewMemberId)}
                disabled={busy !== null}
                className="w-full border-b border-line px-4 py-5 text-left text-xl font-semibold text-ink last:border-b-0 disabled:opacity-40"
              >
                {busy === p.crewMemberId ? 'Setting up…' : p.name}
              </button>
            ))}
          </div>
          <p className="px-4 pt-4 text-center text-sm text-muted">
            Not listed? Your PM can add you, or punch you in themselves.
          </p>
        </section>
      )}
    </div>
  )
}
