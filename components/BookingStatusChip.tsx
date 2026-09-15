'use client'

import { useEffect, useRef, useState } from 'react'
import { useBoardPaint } from '@/components/BoardPaint'
import { useRouter } from 'next/navigation'
import Chip from '@/components/ui/Chip'
import { useDismiss } from '@/lib/useDismiss'
import { useMenuPlacement } from '@/lib/useMenuPlacement'
import { cn } from '@/lib/cn'

// The booking status on a tracker crew row — and the chip IS the control.
//
// Dan (2026-09-07): "The 3 dots are not intuitive and that is critical
// information… Click the pencilled to have a context menu… The less extra
// buttons on the tracker the better." Then: "Simplicity and less verbiage is
// key." So ON THE TRACKER the menu is CONFIRMED and DECLINED, nothing else, and
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

// "Not Asked", not "Pencilled" (Dan, 2026-09-09). The database value stays
// `pencilled` — renaming a column value is a migration for no visible gain,
// the same call crew_call_positions already got — but the word on screen says
// what is actually true of that person: they are holding a slot and nobody has
// contacted them.
const LABEL: Record<Status, string> = { pencilled: 'Not Asked', invited: 'Asked', confirmed: 'Confirmed', declined: 'Declined' }

// "Thu, Oct 1" — the same shape every other date in the app wears. Weekday plus
// a bare number rendered as "1 Thu" here, which reads as a quantity.
function shortDay(date: string) {
  return new Date(date + 'T00:00:00')
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function BookingStatusChip({
  showId, crewMemberId, crewName, status: initial, locked = false, context = 'tracker',
  date, theirDates = [],
}: {
  showId: string
  crewMemberId: string | null
  crewName: string
  status: string | null | undefined
  locked?: boolean
  /** The day this chip's cell is. With it, Remove can offer just that day. */
  date?: string
  /** Every day they hold on this show. Empty on the tracker, which has no
   *  board to read it from — there Remove stays show-wide, as it always was. */
  theirDates?: string[]
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
  // The menu becomes the removal question rather than opening a second thing
  // over the top of it. Somebody who was ASKED or said YES is expecting to
  // work, so that question carries the offer to tell them (Dan, 2026-09-08).
  // WHAT IS BEING TAKEN BACK — decided by which menu item was pressed, not by
  // editing a selection inside the confirm (Dan, 2026-09-15: "What about
  // 'remove this day'. Without day editing capabilities, this grid is nothing
  // more than an overview of the week"). null = the slip is closed.
  const [removing, setRemoving] = useState<null | 'day' | 'show'>(null)
  // Only worth offering separately when they hold more than one day; on a
  // one-day booking the two are the same act. The tracker passes neither, so
  // it keeps the single show-wide Remove it has always had.
  const perDay = theirDates.length > 1 && !!date
  // Present on the Scheduling screen, null on the tracker — the chip lives on
  // both and only one of them draws a grid to paint.
  const paint = useBoardPaint()
  // Click anywhere else, or press Escape, and it goes away — including the
  // removal question, which asks something and should not trap anybody.
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  useDismiss(open, wrapRef, () => { setOpen(false); setRemoving(null) })
  // On the last row of the grid there is nothing below to open into.
  // Both axes: this menu lives in a grid of days that scrolls sideways inside
  // its own box, so on the last column there is nothing to the right of it.
  const place = useMenuPlacement(open, wrapRef, removing ? 220 : 190, removing ? 270 : 190)
  const panelSide = cn(
    place.vertical === 'up' ? 'bottom-full mb-1' : 'top-full mt-1',
    place.horizontal === 'right' ? 'right-0' : 'left-0',
  )

  if (!crewMemberId) return null
  // On the TRACKER a confirmed person shows NOTHING (Dan, 2026-09-07: "the
  // tracker should be simple") — the chip exists only while an answer is owed.
  // On the SCHEDULING screen it stays: recording that somebody backed out is a
  // scheduling job, and there has to be somewhere to do it.
  if (status === 'confirmed' && context === 'tracker') return null
  const tappable = !locked
  const tone = status === 'declined' ? 'danger' : status === 'confirmed' ? 'good' : 'neutral'
  // Somebody who was asked or has said yes is expecting to work; a pencilled
  // person has never been contacted, so there is nobody to tell.
  const answered = status === 'invited' || status === 'confirmed'

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
  // menu stays Confirmed / Declined.
  async function remove(notify: boolean) {
    const dates = removing === 'day' && date ? [date] : undefined
    const body = await post('/api/bookings/remove', { showId, crewMemberId, notify, dates })
    if (!body) return
    // STILL ON THE SHOW, fewer days: the right message is their revised
    // schedule, which /api/crew/days-changed already builds from a person's
    // LIVE days — exactly what is left after the delete. The remove route
    // deliberately does not send it, so it never has to own a second copy.
    if (notify && body.remaining > 0 && crewMemberId) {
      const told = await post('/api/crew/days-changed', { showId, crewMemberIds: [crewMemberId] })
      if (told) setNote(`Told ${crewName.split(' ')[0]} their days changed.`)
    }
    setRemoving(null)
    setOpen(false)
    // TAKE THEM OFF THE GRID NOW. The delete is already done and verified
    // server-side; what used to follow was a full re-render of the whole
    // screen before the name went away (Dan, 2026-09-15: "Removing someone is
    // not [faster]"). Show-wide, like the route itself — every cell of theirs,
    // not the one whose chip was clicked.
    if (crewMemberId) paint?.paint([{ kind: 'remove', crewMemberId, dates }])
    // The note is for the email's fate, which the row cannot say.
    if (body.warning) setNote(body.warning)
    router.refresh()
  }

  async function ask() {
    const body = await post('/api/bookings/send', { showId, crewMemberId })
    if (!body) return
    setStatus('invited')
    setOpen(false)
    setNote(body.emailed ? `Asked ${crewName.split(' ')[0]} by email.` : (body.warning || 'No email on file for them.'))
    router.refresh()
  }

  return (
    <span ref={wrapRef} className="relative inline-flex items-center">
      {tappable ? (
        <button
          type="button"
          onClick={() => { setOpen(v => !v); setRemoving(null); setNote('') }}
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

      {open && removing && (
        <div className={cn('absolute z-50 w-64 border-2 border-ink bg-surface p-3 shadow-edge', panelSide)}>
          <p className="text-sm text-ink">
            {removing === 'day' && date
              ? `Take ${crewName.split(' ')[0]} off ${shortDay(date)}? Their other ${theirDates.length - 1} day${theirDates.length === 2 ? '' : 's'} stay.`
              : `Remove ${crewName.split(' ')[0]} from this show? Every day of theirs goes with it.`}
          </p>
          {answered && (
            <p className="mt-1 text-xs text-muted">
              {status === 'confirmed' ? 'They said yes' : 'They were asked'} — do you want them told?
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {answered ? (
              <>
                <button type="button" disabled={busy} onClick={() => remove(true)}
                  className="rounded-field border-2 border-ink px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-40">
                  {removing === 'day' ? 'Take the day and tell them' : 'Remove and tell them'}
                </button>
                <button type="button" disabled={busy} onClick={() => remove(false)}
                  className="rounded-field px-2.5 py-1 text-xs font-semibold text-danger hover:bg-surface-2 disabled:opacity-40">
                  {removing === 'day' ? 'Take the day, say nothing' : 'Remove, say nothing'}
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => remove(false)}
                className="rounded-field border-2 border-ink px-2.5 py-1 text-xs font-semibold text-danger hover:bg-surface-2 disabled:opacity-40">
                {removing === 'day' ? 'Take the day' : 'Remove'}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => { setRemoving(null); setOpen(false) }}
              className="px-1 text-xs text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && !removing && (
        <div role="menu" className={cn('absolute z-50 min-w-[11rem] border-2 border-ink bg-surface p-1 shadow-edge', panelSide)}>
          {status !== 'confirmed' && (
            <button type="button" role="menuitem" disabled={busy} onClick={() => record('confirmed')}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
              Confirmed
            </button>
          )}
          {/* Confirmed and Declined are both just ANSWERS being written down, so
              they read alike; the red belongs to the one act that destroys
              something. Declined was danger-coloured until 2026-09-08 and Dan
              could not tell it from Remove at a glance. */}
          {status !== 'declined' && (
            <button type="button" role="menuitem" disabled={busy} onClick={() => record('declined')}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
              Declined
            </button>
          )}
          {context === 'scheduling' && status === 'pencilled' && (
            <button type="button" role="menuitem" disabled={busy} onClick={ask}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-40">
              Ask by email
            </button>
          )}
          {/* THE DAY FIRST: it is the commoner act — somebody is unavailable
              on the Thursday, not off the job. Both are red; only these two
              destroy anything, which is the whole reason the answers above
              them are ink (Dan, 2026-09-08). */}
          {perDay && (
            <button type="button" role="menuitem" disabled={busy} onClick={() => setRemoving('day')}
              className="mt-1 block w-full border-t-2 border-line px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-40">
              Remove this day
            </button>
          )}
          <button type="button" role="menuitem" disabled={busy}
            onClick={() => setRemoving('show')}
            className={cn(
              'block w-full px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-40',
              !perDay && 'mt-1 border-t-2 border-line',
            )}>
            {perDay ? 'Remove from the show' : 'Remove'}
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
