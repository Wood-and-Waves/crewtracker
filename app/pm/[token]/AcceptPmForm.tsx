'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'

// What a production manager can do on the invitation page.
//
// BOTH BUTTONS IN THE EMAIL ARE THE ANSWER (Dan, 2026-09-08: "A click from the
// email is definitive. There can be a reversal, but a decline click in the
// email should not bring up another decline button"). The page performs the
// answer before it renders and tells this component which state it is in, so
// what is left here is the way back — and, after a decline, the note.
//
// THE NOTE COMES AFTER, NOT BEFORE. A decline is recorded the moment they press
// it and whoever named them is emailed straight away, because that is the news
// they act on. The reason is worth having but must not stand between somebody
// and saying no, so it is offered on the page afterwards and sent on its own.

export default function AcceptPmForm({
  token, accepted = false, declined = false, note: sentNote = null,
}: {
  token: string
  /** They hold the show — the link accepted it, or they pressed Accept. */
  accepted?: boolean
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

  // They said no. One button back, and a place to say why if they want to.
  if (declined) {
    return (
      <div>
        <Button className="w-full" disabled={busy} onClick={accept}>
          {busy ? 'Opening…' : 'Actually, I can do this show'}
        </Button>
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

  return (
    <div>
      {!accepted && (
        <Button className="w-full" disabled={busy} onClick={accept}>
          {busy ? 'Opening…' : 'Accept and open the show'}
        </Button>
      )}
      <button
        type="button"
        className="mt-3 block w-full text-center text-sm font-semibold text-danger hover:underline"
        disabled={busy}
        onClick={decline}
      >
        {accepted ? 'Actually, I can’t do this show' : 'Decline'}
      </button>
      {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}
    </div>
  )
}
