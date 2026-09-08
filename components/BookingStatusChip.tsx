'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Chip from '@/components/ui/Chip'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'

// The booking status on a tracker crew row — and the chip IS the control.
//
// Dan (2026-09-07): "The 3 dots are not intuitive and that is critical
// information… Click the pencilled to have a context menu… The less extra
// buttons on the tracker the better." So: Pencilled and Asked are tappable
// and open a short in-place menu; Confirmed is a plain chip with nothing to
// tap. The menu posts to the same routes the Positions panel uses —
// /api/bookings/record (show-wide, like a decline; a recorded yes can complete
// the show and send the ready email) and /api/bookings/send.
//
// Scheduling-module only: booking status is a scheduling state. Without the
// module the row shows nothing here, exactly as before.

type Status = 'pencilled' | 'invited' | 'confirmed' | 'declined'

const LABEL: Record<Status, string> = { pencilled: 'Pencilled', invited: 'Asked', confirmed: 'Confirmed', declined: 'Declined' }

export default function BookingStatusChip({
  showId, crewMemberId, crewName, status: initial, locked = false, timecardId, role, dayLabel,
}: {
  showId: string
  crewMemberId: string | null
  crewName: string
  status: string | null | undefined
  locked?: boolean
  /** This row's timecard — "Remove from this room" deletes it (the same write
   *  the ⋮ → Edit crew panel makes; Dan, 2026-09-07: that job should not live
   *  behind the three dots). */
  timecardId: string
  role?: string | null
  /** The row's date (YYYY-MM-DD), for the staffing event's "Tue 8". */
  dayLabel?: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [status, setStatus] = useState<Status>((initial as Status) || 'pencilled')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  if (!crewMemberId) return null
  // Every status is tappable while the show is open: a confirmed person can
  // back out ("Declined"), and anyone can be removed from the room.
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

  async function remove() {
    if (!confirm(`Remove ${crewName} from this room today? This deletes their punches for this day.`)) return
    setBusy(true); setNote('')
    const { data, error } = await supabase.from('timecards').delete().eq('id', timecardId).select('id')
    setBusy(false)
    if (error || !data?.length) { setNote(error?.message ?? 'That did not save.'); return }
    await logStaffingEvent(supabase, { showId, kind: 'released', crewMemberId, crewMemberName: crewName, role: role ?? null, days: dayLabel ? compressDays([dayLabel]) : null })
    setOpen(false)
    router.refresh()
  }

  async function ask() {
    const data = await post('/api/bookings/send', { showId, crewMemberId })
    if (!data) return
    setStatus('invited')
    setOpen(false)
    setNote(data.emailed ? `Asked ${crewName.split(' ')[0]} by email.` : (data.warning || 'Request created, but no email went out.'))
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
          <Chip tone={status === 'confirmed' ? 'good' : status === 'declined' ? 'danger' : 'neutral'}>{LABEL[status]} ▾</Chip>
        </button>
      ) : (
        <Chip tone={status === 'confirmed' ? 'good' : status === 'declined' ? 'danger' : 'neutral'}>{LABEL[status]}</Chip>
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
          {status === 'pencilled' && (
            <button type="button" role="menuitem" disabled={busy} onClick={ask}
              className="block w-full border-t border-line px-3 py-2 text-left text-sm text-accent hover:bg-surface-2 disabled:opacity-40">
              Ask by email
            </button>
          )}
          <button type="button" role="menuitem" disabled={busy} onClick={remove}
            className="block w-full border-t border-line px-3 py-2 text-left text-sm text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40">
            Remove from this room
          </button>
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
