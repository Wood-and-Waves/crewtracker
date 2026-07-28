'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'

// Confirm or decline. The answer is POSTed — never sent by following a link.
// Outlook Safe Links and Gmail prefetch URLs in email, so a GET carrying the
// answer would be recorded by a scanner before the person read the message.
//
// An existing answer can be changed. People genuinely do confirm and then have
// something come up, and the alternative is a phone call to the scheduler.

export default function BookingResponseForm({
  token,
  alreadyResponded,
  respondedAt,
}: {
  token: string
  alreadyResponded: 'confirmed' | 'declined' | null
  respondedAt: string | null
}) {
  const [answer, setAnswer] = useState<'confirmed' | 'declined' | null>(alreadyResponded)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changing, setChanging] = useState(false)

  async function respond(response: 'confirmed' | 'declined') {
    setBusy(true)
    setError('')
    const res = await fetch('/api/bookings/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, response, note: note.trim() || undefined }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(body.error || 'Something went wrong. Please try again.')
      return
    }
    setAnswer(response)
    setChanging(false)
  }

  if (answer && !changing) {
    return (
      <div className="text-center">
        <p className="text-lg font-bold text-ink">
          {answer === 'confirmed' ? "You're booked in" : "You've declined"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {answer === 'confirmed'
            ? 'Thanks — they know you can do it.'
            : 'Thanks for letting them know.'}
          {respondedAt && !busy ? '' : ''}
        </p>
        <button
          onClick={() => setChanging(true)}
          className="mt-4 text-xs text-muted underline hover:text-ink"
        >
          Change my answer
        </button>
      </div>
    )
  }

  return (
    <div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Anything they should know? (optional)"
        className="mb-3 w-full resize-none rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />

      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1"
          disabled={busy}
          onClick={() => respond('declined')}
        >
          Can&apos;t make it
        </Button>
        <Button
          className="flex-1"
          disabled={busy}
          onClick={() => respond('confirmed')}
        >
          {busy ? 'Sending…' : "I'm in"}
        </Button>
      </div>

      {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}

      {changing && (
        <button
          onClick={() => setChanging(false)}
          className="mt-3 w-full text-center text-xs text-muted underline hover:text-ink"
        >
          Never mind, keep my answer
        </button>
      )}
    </div>
  )
}
