'use client'

import { useState } from 'react'

// The venue-QR path: which room, then which name.
//
// Two taps rather than one long list, because a big show is fifty names and
// because a room is the thing somebody standing in it can answer without
// thinking. Picking a name trades this shared code for that person's own link
// and sends them there, so they can bookmark it and never see this screen
// again.

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
    <div>
      <p className="text-center font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
        Clock in &amp; out
      </p>
      <h1 className="mt-1 text-center text-xl font-bold text-ink">{showName}</h1>
      {venue && <p className="mb-5 text-center text-sm text-muted">{venue}</p>}

      {error && <p className="mb-3 text-center text-sm text-danger">{error}</p>}

      {!room ? (
        <>
          <p className="mb-2 mt-4 text-center text-sm font-semibold text-ink">Which room are you in?</p>
          <div className="border-t-[3px] border-ink">
            {roster.map(r => (
              <button
                key={r.room}
                onClick={() => setRoom(r.room)}
                className="flex w-full items-center justify-between border-b border-line py-4 text-left"
              >
                <span className="text-base text-ink">{r.room}</span>
                <span className="text-xs text-muted">
                  {r.people.length} {r.people.length === 1 ? 'person' : 'people'}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-2 mt-4 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-ink">Find your name</p>
            {roster.length > 1 && (
              <button onClick={() => setRoom(null)} className="text-xs font-semibold uppercase tracking-wide text-accent">
                Change room
              </button>
            )}
          </div>
          <div className="border-t-[3px] border-ink">
            {people.map(p => (
              <button
                key={p.crewMemberId}
                onClick={() => pick(p.crewMemberId)}
                disabled={busy !== null}
                // py-4 rather than the app's usual py-2: this is tapped with a
                // thumb, in the dark, by somebody carrying a case.
                className="w-full border-b border-line py-4 text-left text-base text-ink disabled:opacity-40"
              >
                {busy === p.crewMemberId ? 'Setting up…' : p.name}
              </button>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-muted">
            Not listed? Your PM can add you, or punch you in themselves.
          </p>
        </>
      )}
    </div>
  )
}
