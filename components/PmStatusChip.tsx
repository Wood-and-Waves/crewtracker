'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Chip from '@/components/ui/Chip'
import { useDismiss } from '@/lib/useDismiss'
import type { PmState } from '@/components/PmField'

// The PM's answer, as a chip that IS the control — the same gesture as a crew
// member's status chip (Dan, 2026-09-08: "Why would the PM say not accepted
// yet? Instead of the same pill actions as the crew? I should also be able to
// accept for them as well").
//
// A PM says yes on the phone exactly as crew do, and the person recording it
// can already grant the same access by hand on Edit Show → Show Access. So
// this is not a new power, it is the same one where the answer arrives. What
// it is NOT is silent: naming somebody still grants nothing on its own, and
// recording an acceptance says in words that it opens the show to them.
//
// Changing WHO the PM is stays on Edit Show — that needs the member picker,
// and this is a chip.

export default function PmStatusChip({
  showId, pm, editHref,
}: {
  showId: string
  pm: PmState
  /** Edit Show, where the PM is named and replaced. */
  editHref: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  useDismiss(open, wrapRef, () => setOpen(false))

  // Nobody named: there is no answer to record and no invitation to resend, so
  // the only thing to offer is the screen that names one.
  if (!pm.profileId) {
    return (
      <Link href={editHref} className="text-xs text-muted hover:text-ink">
        No PM yet
      </Link>
    )
  }

  const accepted = !!pm.acceptedAt
  const name = pm.name ?? 'them'

  async function post(body: Record<string, unknown>) {
    setBusy(true); setNote('')
    const res = await fetch('/api/pm/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showId, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setNote(data.error || 'That did not save.'); return null }
    return data
  }

  async function record() {
    if (!confirm(`Record that ${name} accepted? This opens the show to them, the same as if they had pressed Accept in their email.`)) return
    const ok = await post({ profileId: pm.profileId, markAccepted: true })
    if (!ok) return
    setOpen(false)
    router.refresh()
  }

  async function resend() {
    const data = await post({ profileId: pm.profileId, resend: true })
    if (!data) return
    setOpen(false)
    setNote(data.warning || `Invitation sent again to ${name}.`)
  }

  return (
    <span ref={wrapRef} className="relative inline-flex items-center gap-1.5">
      <span className="text-xs text-muted">PM: <span className="text-ink">{name}</span></span>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setNote('') }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={accepted ? 'They have accepted' : 'Tap to record their answer'}
        className="rounded-pill focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
      >
        <Chip tone={accepted ? 'good' : 'ot'}>{accepted ? 'Accepted' : 'Invited'} ▾</Chip>
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 min-w-[12rem] border-2 border-ink bg-surface p-1 shadow-edge">
          {!accepted && (
            <>
              <button type="button" role="menuitem" disabled={busy} onClick={record}
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
                Accepted
              </button>
              <button type="button" role="menuitem" disabled={busy} onClick={resend}
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
                Send the invitation again
              </button>
            </>
          )}
          <Link role="menuitem" href={editHref} className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2">
            Change the PM
          </Link>
          <button type="button" role="menuitem" disabled={busy} onClick={() => setOpen(false)}
            className="block w-full px-3 py-1.5 text-left text-xs text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      )}
      {note && <span className="text-[11px] text-muted">{note}</span>}
    </span>
  )
}
