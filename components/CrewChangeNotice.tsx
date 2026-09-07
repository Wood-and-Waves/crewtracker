'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'

// Offered — never forced — after a staffing change a crew member should
// probably hear about: a position move, a release, a room removal (all
// PositionDefsSection/RoomActionsMenu), or an Add-Day extension
// (AddDayButton). Same in-place confirm-bar shape as PmField's confirm: a 3px
// accent rule, not a dialog, because this is a suggestion, not a decision
// blocking anything.

export default function CrewChangeNotice({
  showId,
  people,
  onDone,
}: {
  showId: string
  people: { id: string; name: string }[]
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ sent: number; skipped: string[] } | null>(null)
  const [error, setError] = useState('')

  async function send() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/crew/days-changed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, crewMemberIds: people.map(p => p.id) }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(data.error || 'That did not send.'); return }
    setResult({ sent: data.sent ?? 0, skipped: data.skipped ?? [] })
    // Show the result for a moment, then let the caller drop the notice —
    // the same shape as SendHoursButton's transient confirmation.
    setTimeout(onDone, 1500)
  }

  if (result) {
    return (
      <div className="border-l-[3px] border-accent py-1 pl-3">
        <p className="text-sm text-ink">
          Sent to {result.sent}.
          {result.skipped.length > 0 && ` Couldn't reach: ${result.skipped.join(', ')}.`}
        </p>
      </div>
    )
  }

  return (
    <div className="border-l-[3px] border-accent py-1 pl-3">
      <p className="text-sm text-ink">
        Tell the {people.length} crew whose days changed?{' '}
        <span className="text-muted">{people.map(p => p.name).join(', ')}</span>
      </p>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send'}</Button>
        <button type="button" className="text-xs text-muted hover:text-ink" disabled={busy} onClick={onDone}>Not now</button>
      </div>
    </div>
  )
}
