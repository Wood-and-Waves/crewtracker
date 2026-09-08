'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Chip from '@/components/ui/Chip'

// The booking status on a tracker crew row — and the chip IS the control.
//
// Dan (2026-09-07): "The 3 dots are not intuitive and that is critical
// information… Click the pencilled to have a context menu… The less extra
// buttons on the tracker the better." Then: "Simplicity and less verbiage is
// key." So ON THE TRACKER the menu is APPROVED and DECLINED, nothing else, and
// a confirmed person shows no chip at all — removing a booking stays under
// ⋮ → Edit crew.
//
// The SCHEDULING screen is the other half of the same control: there a
// confirmed chip is shown and tappable (somebody backs out), and a pencilled
// one also offers Ask by email, which is the single-person ask the Positions
// panel used to hold. Posts to /api/bookings/record (show-wide, like a decline;
// a recorded yes can complete the show and send the ready email) and to
// /api/bookings/send for the ask.
//
// Scheduling-module only: booking status is a scheduling state. Without the
// module the row shows nothing here, exactly as before.

type Status = 'pencilled' | 'invited' | 'confirmed' | 'declined'

const LABEL: Record<Status, string> = { pencilled: 'Pencilled', invited: 'Asked', confirmed: 'Confirmed', declined: 'Declined' }

export default function BookingStatusChip({
  showId, crewMemberId, crewName, status: initial, locked = false, context = 'tracker',
}: {
  showId: string
  crewMemberId: string | null
  crewName: string
  status: string | null | undefined
  locked?: boolean
  /** 'tracker' hides a confirmed chip entirely; 'scheduling' shows it and lets
   *  it be tapped (somebody backed out) and offers the single Ask by email. */
  context?: 'tracker' | 'scheduling'
}) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>((initial as Status) || 'pencilled')
  // Re-seed from the prop after a refresh. Recording an answer is show-WIDE, so
  // one click changes every day that person holds — and on the Scheduling
  // screen those other days are on screen. Without this they kept painting the
  // old status until a full reload, which reads as the write having failed.
  // Deliberately an effect, not a `key`: a key would remount the chip and close
  // an open menu whenever a sibling's refresh landed (the TimecardRow lesson).
  useEffect(() => { setStatus((initial as Status) || 'pencilled') }, [initial])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  if (!crewMemberId) return null
  // On the TRACKER a confirmed person shows NOTHING (Dan, 2026-09-07: "the
  // tracker should be simple") — the chip exists only while an answer is owed.
  // On the SCHEDULING screen it stays: recording that somebody backed out is a
  // scheduling job, and there has to be somewhere to do it.
  if (status === 'confirmed' && context === 'tracker') return null
  const tappable = !locked
  const tone = status === 'declined' ? 'danger' : status === 'confirmed' ? 'good' : 'neutral'

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

  // Ask ONE person by email. The group ask covers a whole show, but a scheduler
  // who has just booked somebody wants to ask them now — and the Positions
  // panel that used to own this is gone. Scheduling screen only: the tracker's
  // menu stays Approved / Declined.
  async function ask() {
    const body = await post('/api/bookings/send', { showId, crewMemberId })
    if (!body) return
    setStatus('invited')
    setOpen(false)
    setNote(body.emailed ? `Asked ${crewName.split(' ')[0]} by email.` : (body.warning || 'No email on file for them.'))
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
          <Chip tone={tone}>{LABEL[status]} ▾</Chip>
        </button>
      ) : (
        <Chip tone={tone}>{LABEL[status]}</Chip>
      )}

      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 min-w-[11rem] border-2 border-ink bg-surface p-1 shadow-edge">
          {status !== 'confirmed' && (
            <button type="button" role="menuitem" disabled={busy} onClick={() => record('confirmed')}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
              Approved
            </button>
          )}
          {status !== 'declined' && (
            <button type="button" role="menuitem" disabled={busy} onClick={() => record('declined')}
              className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-surface-2 disabled:opacity-40">
              Declined
            </button>
          )}
          {context === 'scheduling' && status === 'pencilled' && (
            <button type="button" role="menuitem" disabled={busy} onClick={ask}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
              Ask by email
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
