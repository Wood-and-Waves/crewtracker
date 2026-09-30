'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Chip from '@/components/ui/Chip'
import AnchoredPanel from '@/components/ui/AnchoredPanel'
import {
  CONFIRM_SHOW_PROMPT, UNCONFIRM_SHOW_PROMPT, NOTIFY_CREW_PROMPT,
  NOTIFY_CREW_AGAIN_PROMPT, describeUnreached, describeCrewTold,
} from '@/lib/showConfirmed'

// Is this show sold, or are we holding the dates?
//
// Dan, 2026-09-29: the client asks for a hold long before the job is confirmed,
// and until now the app could not tell the difference — so a scheduler asking
// somebody to hold October had to say so by hand in every message.
//
// THE CHIP IS THE CONTROL, and that placement is the point. Dan asked three
// times where a show gets marked confirmed; the honest answer is "where you are
// when the client rings", which is this screen. The PM chip beside it works the
// same way for the same reason — a PM says yes on the phone as often as crew
// do, and so does a client. Putting it only on Edit Show would have made the
// commonest moment a detour.
//
// ONLY THE UNCONFIRMED STATE WEARS A CHIP. Once a show is sold it says nothing
// at all: that is the ordinary case, and a badge on every confirmed show would
// be wallpaper. Same rule the tracker already follows, where a crew row that
// has accepted shows no chip. It wears `ot` (amber) because an unsold show with
// crew penned in is genuinely a thing to keep an eye on.
//
// IT NEVER LOOKS TAPPABLE AND THEN FAILS. The `shows` UPDATE policy has no
// scheduler arm, so Sasha's write would match no row — she gets a plain chip
// with no menu rather than a button that refuses.
//
// The word "pencilled" is deliberately absent (Dan: "not write 'penciled'").
// Pencil survives only as the verb on the fill picker's button.

export default function ShowConfirmedChip({
  showId, confirmedAt, noticeSentAt, canEdit,
}: {
  showId: string
  /** Null = holding the dates. */
  confirmedAt: string | null
  /**
   * When the crew were last told. Null on a confirmed show means nobody has
   * been told, which is what puts the Tell the crew button on screen.
   *
   * MARKING CONFIRMED SENDS NOTHING (Dan, 2026-09-30) — the two are separate
   * presses on purpose, so a toggle pressed to see what it does cannot reach
   * thirty freelancers.
   */
  noticeSentAt: string | null
  /** Does the caller pass the shows UPDATE policy? A read-only viewer gets a
   *  plain chip; see the header. */
  canEdit: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const wrapRef = useRef<HTMLSpanElement | null>(null)

  const confirmed = !!confirmedAt
  const told = !!noticeSentAt

  async function set(next: boolean) {
    if (next) {
      if (!confirm(CONFIRM_SHOW_PROMPT)) return
    } else if (!confirm(UNCONFIRM_SHOW_PROMPT)) return

    setBusy(true); setNote('')
    const res = await fetch('/api/shows/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, confirmed: next }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setNote(data.error || 'That did not save.'); return }
    setOpen(false)
    router.refresh()
  }

  /** The second press: the only thing in the app that sends this email. */
  async function tellCrew() {
    if (!confirm(told ? NOTIFY_CREW_AGAIN_PROMPT : NOTIFY_CREW_PROMPT)) return

    setBusy(true); setNote('')
    const res = await fetch('/api/shows/confirm/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setNote(data.error || 'The emails did not send.'); return }
    setNote(describeUnreached(data.noEmail ?? []))
    setOpen(false)
    router.refresh()
  }

  // Sold, and the viewer cannot change it: nothing worth saying.
  if (confirmed && !canEdit) return null

  if (!canEdit) {
    return <Chip tone="ot">Not confirmed</Chip>
  }

  return (
    <span ref={wrapRef} className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setNote('') }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={confirmed ? 'The client has confirmed this show' : 'Holding the dates — tap when the client confirms'}
        className="rounded-pill focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
      >
        {confirmed
          ? <span className="text-xs text-muted hover:text-ink">
              {told ? describeCrewTold(noticeSentAt) : 'Confirmed'} ▾
            </span>
          : <Chip tone="ot">Not confirmed ▾</Chip>}
      </button>

      {/* THE SECOND PRESS, and it is a real button rather than a menu item
          because it is the one that writes to people — Dan asked for exactly
          this after deciding an automatic send on the toggle was too risky.
          It appears only while there is news nobody has passed on; once the
          crew have been told, sending again moves into the menu, where it is
          a deliberate choice rather than a button sitting there inviting a
          second copy. Same rule as everything else on this screen: only the
          thing still needing attention wears ink. */}
      {confirmed && !told && (
        <button
          type="button"
          disabled={busy}
          onClick={tellCrew}
          className="rounded-field border-2 border-ink px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-bg disabled:opacity-40"
        >
          {busy ? 'Sending…' : 'Tell the crew'}
        </button>
      )}

      <AnchoredPanel
        anchorRef={wrapRef}
        open={open}
        onDismiss={() => setOpen(false)}
        role="menu"
        className="min-w-[14rem] border-2 border-ink bg-surface p-1 shadow-edge"
      >
        <div>
          {!confirmed ? (
            <button type="button" role="menuitem" disabled={busy} onClick={() => set(true)}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
              Mark the show confirmed
            </button>
          ) : (
            <>
              {told && (
                <button type="button" role="menuitem" disabled={busy} onClick={tellCrew}
                  className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
                  Tell the crew again
                </button>
              )}
              <button type="button" role="menuitem" disabled={busy} onClick={() => set(false)}
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
                Put it back to holding dates
              </button>
            </>
          )}
          <button type="button" role="menuitem" disabled={busy} onClick={() => setOpen(false)}
            className="block w-full px-3 py-1.5 text-left text-xs text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      </AnchoredPanel>
      {note && <span className="text-[11px] text-ot">{note}</span>}
    </span>
  )
}
