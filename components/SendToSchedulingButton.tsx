'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'

// Sending a show to scheduling (piece C of the 2026-09-07 show-flow spec).
//
// No member picker: this used to name ONE scheduler and email only them.
// Now it goes to EVERYONE in the company holding can_manage_scheduling —
// nobody owns a sent show, and it's first come, first served. So the only
// choice left is whether to send it at all, confirmed in place like PmField,
// never a fixed-position dialog.

function fmt(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function SendToSchedulingButton({
  showId,
  sentAt,
  positionCount,
  callSize,
  initialOpen = false,
}: {
  showId: string
  sentAt: string | null
  /** Position ROWS across the whole show. Zero means nothing to schedule. */
  positionCount: number
  /** Human phrasing, e.g. "12 crew across 5 days" — what the email leads with. */
  callSize: string
  /** Open the confirm at once — New Show's "Create show and send to scheduler"
   *  lands here with ?handoff=1 so the next step is already on screen. */
  initialOpen?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(initialOpen && !sentAt && positionCount > 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function send() {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')

    const res = await fetch('/api/shows/send-to-scheduling', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(body.error || 'Could not send this show to scheduling.')
      return
    }
    setOpen(false)
    const n = body.sentTo ?? 0
    setNotice(body.warning || `Sent to ${n} scheduler${n === 1 ? '' : 's'}.`)
    router.refresh()
  }

  async function takeBack() {
    if (busy) return
    if (!confirm('Take this show back from scheduling? Schedulers lose sight of it until it is sent again.')) return
    setBusy(true)
    setError('')
    setNotice('')

    const res = await fetch('/api/shows/send-to-scheduling', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, takeBack: true }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(body.error || 'Could not take this show back.')
      return
    }
    router.refresh()
  }

  const nothingToSend = positionCount === 0

  const stateBlock = sentAt ? (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Chip tone="good">With scheduling</Chip>
      <span>since {fmt(sentAt)}</span>
      <button
        type="button"
        className="font-semibold text-accent hover:underline disabled:opacity-40"
        disabled={busy}
        onClick={takeBack}
      >
        Take back
      </button>
    </div>
  ) : (
    <div>
      {/* The opener steps aside while the confirm is showing. Left in place it
          was a button that did nothing (Dan, 2026-09-07, arriving from New
          Show with the confirm already open). */}
      {!open && (
        <Button
          variant="ghost"
          size="md"
          onClick={() => setOpen(true)}
          disabled={nothingToSend}
          title={nothingToSend ? 'Add positions first — there is nothing to schedule yet.' : undefined}
        >
          Send to scheduler
        </Button>
      )}

      {open && (
        <div className="border-l-[3px] border-accent py-1 pl-3">
          <p className="text-sm text-ink">
            Send {callSize} to scheduling? Everyone with the scheduling permission gets an email, and any of them can fill the positions.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send'}</Button>
            <button type="button" className="text-xs text-muted hover:text-ink" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div>
      {stateBlock}
      {notice && <p className="mt-2 text-xs text-muted">{notice}</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
