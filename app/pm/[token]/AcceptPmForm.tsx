'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'

// What a production manager can do on the invitation page.
//
// Since 2026-09-08 the emailed LINK accepts (Dan: "I would like the accept from
// the email to be an actual accept"), so by the time most people see this they
// are already the PM and the only thing left to offer is the way out. The page
// says which state it is in and passes `accepted`.
//
// Declining takes a NOTE, because the reason is the useful part to whoever named
// them ("I'm on another show that week"), and it goes to them unedited. The
// note is optional: somebody who just wants out should not have to write an
// excuse first.

export default function AcceptPmForm({
  token, accepted = false,
}: {
  token: string
  /** They already hold the show — the link accepted it, or they pressed Accept. */
  accepted?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [declining, setDeclining] = useState(false)
  const [note, setNote] = useState('')
  const [declined, setDeclined] = useState(false)

  async function accept() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/pm/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setBusy(false)
      setError(body.error || 'Something went wrong. Please try again.')
      return
    }
    // Into the show. Signed out, the app asks them to sign in first.
    window.location.href = `/dashboard/shows/${body.showId}`
  }

  async function decline() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/pm/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, note }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(body.error || 'Something went wrong. Please try again.')
      return
    }
    setDeclined(true)
  }

  if (declined) {
    return (
      <div className="text-center">
        <p className="text-sm font-semibold text-ink">That&rsquo;s done — you&rsquo;re not on this show.</p>
        <p className="mt-1 text-xs text-muted">
          Whoever named you has been told{note.trim() ? ', with your note' : ''}. You can close this page.
        </p>
      </div>
    )
  }

  if (declining) {
    return (
      <div>
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
          className="mb-3 w-full rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <Button className="w-full" variant="danger" disabled={busy} onClick={decline}>
          {busy ? 'Sending…' : 'Decline the show'}
        </Button>
        <button
          type="button"
          className="mt-3 block w-full text-center text-xs text-muted hover:text-ink"
          disabled={busy}
          onClick={() => { setDeclining(false); setError('') }}
        >
          Never mind
        </button>
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
        onClick={() => setDeclining(true)}
      >
        {accepted ? 'Actually, I can’t do this show' : 'Decline'}
      </button>
      {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}
    </div>
  )
}
