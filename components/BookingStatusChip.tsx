'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Chip from '@/components/ui/Chip'

// The booking status on a tracker crew row — and the chip IS the control.
//
// Dan (2026-09-07): "The 3 dots are not intuitive and that is critical
// information… Click the pencilled to have a context menu… The less extra
// buttons on the tracker the better." Then: "Simplicity and less verbiage is
// key." So the menu is APPROVED and DECLINED, nothing else — asking by email
// is the group button on Edit Show (or the Positions panel for one person),
// and removing a booking stays under ⋮ → Edit crew. Every status is tappable
// while the show is open: a confirmed person can still decline (backed out).
// Posts to /api/bookings/record (show-wide, like a decline; a recorded yes can
// complete the show and send the ready email).
//
// Scheduling-module only: booking status is a scheduling state. Without the
// module the row shows nothing here, exactly as before.

type Status = 'pencilled' | 'invited' | 'confirmed' | 'declined'

const LABEL: Record<Status, string> = { pencilled: 'Pencilled', invited: 'Asked', confirmed: 'Confirmed', declined: 'Declined' }

export default function BookingStatusChip({
  showId, crewMemberId, crewName, status: initial, locked = false,
}: {
  showId: string
  crewMemberId: string | null
  crewName: string
  status: string | null | undefined
  locked?: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>((initial as Status) || 'pencilled')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  if (!crewMemberId) return null
  // A confirmed person shows NOTHING (Dan, 2026-09-07: "the tracker should be
  // simple"). The chip exists only while an answer is still owed; a confirmed
  // person who backs out is recorded from the Positions panel / the scheduling
  // screen, not from the tracker row.
  if (status === 'confirmed') return null
  const tappable = !locked

  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true); setNote('')
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setNote(data.error || 'That did not save.'); return null }
    return data
  }

  async function record(response: 'confirmed' | 'declined') {
    const ok = await post('/api/bookings/record', { showId, crewMemberId, response })
    if (!ok) return
    setStatus(response)
    setOpen(false)
    router.refresh()
  }

  return (
    <span className="relative inline-flex items-center">
      {tappable ? (
        <button
          type="button"
          onClick={() => { setOpen(v => !v); setNote('') }}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Tap to record their answer"
          className="rounded-pill focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
        >
          <Chip tone={status === 'declined' ? 'danger' : 'neutral'}>{LABEL[status]} ▾</Chip>
        </button>
      ) : (
        <Chip tone={status === 'declined' ? 'danger' : 'neutral'}>{LABEL[status]}</Chip>
      )}

      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 min-w-[11rem] border-2 border-ink bg-surface p-1 shadow-edge">
          <button type="button" role="menuitem" disabled={busy} onClick={() => record('confirmed')}
            className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
            Approved
          </button>
          {status !== 'declined' && (
            <button type="button" role="menuitem" disabled={busy} onClick={() => record('declined')}
              className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-surface-2 disabled:opacity-40">
              Declined
            </button>
          )}
          <button type="button" role="menuitem" disabled={busy} onClick={() => setOpen(false)}
            className="block w-full px-3 py-1.5 text-left text-xs text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      )}
      {note && <span className="ml-2 text-[11px] text-muted">{note}</span>}
    </span>
  )
}
