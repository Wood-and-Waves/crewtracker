'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'

// What a production manager can do on the invitation page.
//
// AN ANSWER IS FINAL (Dan, 2026-09-09: "An email button press is final"). The
// page performs the answer before it renders and tells this component which
// state it is in; there is no way back from either answer. Somebody whose
// situation changes rings whoever invited them, and that person re-invites or
// replaces them from Edit Show.
//
// This replaced a design that offered "Actually, I can do this show" and
// "Actually, I can't do this show". The crew booking page lost the same thing
// on the same day, for the same reason.
//
// THE NOTE SURVIVES, and comes AFTER the decline rather than before it. A
// decline is recorded the moment they press it and whoever invited them is
// emailed straight away, because that is the news they act on. The reason is
// worth having but must not stand between somebody and saying no — and it
// undoes nothing, so it is not a reversal.

export default function AcceptPmForm({
  token, declined = false, note: sentNote = null,
}: {
  token: string
  /** They said no. The invitation stays open, so this is reversible. */
  declined?: boolean
  /** A note already sent with the decline; shown back rather than asked twice. */
  note?: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [noteSent, setNoteSent] = useState(!!sentNote)

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setBusy(false)
      setError(data.error || 'Something went wrong. Please try again.')
      return null
    }
    return data
  }

  async function accept() {
    const body = await post('/api/pm/accept', { token })
    if (!body) return
    // Into the show. Signed out, the app asks them to sign in first.
    window.location.href = `/dashboard/shows/${body.showId}`
  }

  async function decline() {
    const body = await post('/api/pm/decline', { token, note: note.trim() || undefined })
    if (!body) return
    window.location.reload()
  }

  async function sendNote() {
    const body = await post('/api/pm/decline', { token, note: note.trim() })
    if (!body) return
    setBusy(false)
    setNoteSent(true)
  }

  // They said no. A place to say why, and nothing else.
  if (declined) {
    return (
      <div>
        {noteSent ? (
          <p className="mt-3 text-center text-xs text-muted">
            {sentNote ? `You told them: “${sentNote}”` : 'Your note has been sent.'}
          </p>
        ) : (
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="pm-decline-note">
              Anything to tell them? (optional)
            </label>
            <textarea
              id="pm-decline-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              maxLength={600}
              placeholder="I'm on another show that week."
              className="mb-2 w-full rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              className="block w-full text-center text-sm font-semibold text-accent hover:underline disabled:opacity-40"
              disabled={busy || !note.trim()}
              onClick={sendNote}
            >
              {busy ? 'Sending…' : 'Send them this'}
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}
      </div>
    )
  }

  // Opened cold, without using either button in the email. Accept and Decline,
  // green and red, the same pair as everywhere else.
  return (
    <div>
      <div className="flex gap-2">
        <Button variant="good" className="flex-1" disabled={busy} onClick={accept}>
          {busy ? 'Opening…' : 'Accept'}
        </Button>
        <Button variant="danger" className="flex-1" disabled={busy} onClick={decline}>
          Decline
        </Button>
      </div>
      {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}
    </div>
  )
}
