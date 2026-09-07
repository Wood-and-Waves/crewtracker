'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'
import Button from '@/components/ui/Button'
import Toggle from '@/components/ui/Toggle'
import CrewChangeNotice from '@/components/CrewChangeNotice'

// Extends a show by one day, cloning the last day's rooms and optionally its
// crew. Extracted from EditShowClient so the tracker's day switcher and Edit
// Show share one implementation — iOS offers this in both places, with a
// three-way "Add Day & Copy Crew" / "Add Day (Empty)" / Cancel choice.
//
// With positions by kind (piece B) in play, plain copy-crew stops making
// sense: a show with definitions already knows who belongs on an all-day
// position, so the dialog offers to EXTEND those people instead — one RPC
// (extend_all_day_positions) that only ever tops up an all-day definition's
// open slot on the new day, never touches a day-specific one. Whichever
// person it books gets offered a change notice, the same as a move or a
// release, because their schedule just grew.

// endDate / workDays / rooms used to be props because the client worked out the
// next date and cloned the rooms itself. add_show_day() derives all of that from
// the show id, so passing them would only invite them to drift out of date.
export default function AddDayButton({
  showId,
  hasCrew,
  hasDefs = false,
  variant = 'button',
}: {
  showId: string
  /** Whether the last day has any crew — decides if a choice is offered at all. */
  hasCrew: boolean
  /** Whether the show has any position_defs — decides whether the dialog
   *  offers the extend toggle (positions) or the old copy-crew choice. */
  hasDefs?: boolean
  /**
   * Trigger style. A plain string rather than a render prop: this component is
   * rendered from the server-side tracker page, and functions cannot cross the
   * server/client boundary — see CLAUDE.md on non-component values and the
   * client/server export rule.
   */
  variant?: 'button' | 'circle'
}) {
  const router = useRouter()
  const supabase = createClient()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [extend, setExtend] = useState(true)
  const [extended, setExtended] = useState<{ id: string; name: string }[]>([])

  function open() {
    setError('')
    setExtended([])
    if (hasCrew) setAsking(true)
    else addDay(false)
  }

  async function addDay(copyCrew: boolean) {
    setBusy(true)
    setError('')

    // One call, one transaction. This used to be four sequential writes —
    // extend end_date, insert the day, insert the rooms, insert the crew — so a
    // failure partway through left a half-built day, and retrying then collided
    // with the day already sitting there on that date. The function does the
    // whole thing or none of it; see scripts/sql/applied/add-show-day-function.sql.
    //
    // Date arithmetic lives in SQL now too: `date + 1` on a date column carries
    // no timezone, which is the safest possible version of a calculation this
    // project has got wrong before.
    const { data: rpcData, error: rpcError } = await supabase.rpc('add_show_day', {
      p_show_id: showId,
      p_copy_crew: copyCrew,
    })

    if (rpcError) { setBusy(false); setError(rpcError.message); return }

    // Positions by kind: the new day gets its open slots (piece B). Nobody is
    // booked into them yet — that is a human's call, unless the extend toggle
    // below fills the all-day ones automatically.
    await supabase.rpc('sync_position_slots', { p_show_id: showId })

    // add_show_day returns one row: { work_day_id, day_number, day_date,
    // rooms_created, crew_copied }. supabase-js can hand back either a single
    // row or an array depending on how the function is declared, so handle both.
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData
    const workDayId = row?.work_day_id as string | undefined

    if (hasDefs && extend && workDayId) {
      const { data: extendedRows, error: extendError } = await supabase.rpc(
        'extend_all_day_positions',
        { p_show_id: showId, p_work_day_id: workDayId },
      )
      if (!extendError) {
        // row.day_date is the new day itself — the same one just extended to.
        const extendedDay = row?.day_date ? compressDays([String(row.day_date).slice(0, 10)]) : null
        for (const r of (extendedRows ?? []) as { crew_member_id: string | null; crew_member_name: string; role: string | null }[]) {
          await logStaffingEvent(supabase, {
            showId,
            kind: 'extended',
            crewMemberId: r.crew_member_id,
            crewMemberName: r.crew_member_name,
            role: r.role,
            days: extendedDay,
          })
        }
        const people = ((extendedRows ?? []) as { crew_member_id: string | null; crew_member_name: string }[])
          .filter((r): r is { crew_member_id: string; crew_member_name: string } => !!r.crew_member_id)
          .map(r => ({ id: r.crew_member_id, name: r.crew_member_name }))
        setExtended(people)
        if (people.length > 0) {
          // HOLD the refresh until the notice is answered. The tracker renders
          // this button only on the LAST day; once the new day exists, a
          // refresh drops the button (and the notice with it) from the day the
          // PM is still looking at. Verified on dev: the notice vanished on the
          // phone tracker and survived on Edit Show, where the button stays.
          // onDone below refreshes.
          setBusy(false)
          setAsking(false)
          return
        }
      } else {
        setError(extendError.message)
      }
    }

    setBusy(false)
    setAsking(false)
    router.refresh()
  }

  return (
    // Relative anchor so the change notice below can float without becoming
    // another item in whatever flex row this button sits in — both call
    // sites (the tracker's tight header strip, Edit Show's field row) pack
    // this component alongside other controls, and an in-flow notice would
    // push those out of alignment.
    <span className="relative inline-block">
      {variant === 'circle' ? (
        <button
          onClick={open}
          disabled={busy}
          aria-label="Add another day"
          title="Add another day to this show"
          className="rounded-field bg-accent text-accent-ink h-9 w-9 flex items-center justify-center shrink-0 text-lg leading-none disabled:opacity-50"
        >
          +
        </button>
      ) : (
        <Button variant="ghost" size="sm" onClick={open} disabled={busy}>
          {busy ? 'Adding…' : '+ Add Day'}
        </Button>
      )}

      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge">
            <h2 className="text-lg font-bold text-ink mb-1">Add Next Day?</h2>
            {hasDefs ? (
              <>
                <p className="text-xs text-muted mb-4">
                  The new day gets the same rooms and its own open positions.
                </p>
                <div className="mb-5 flex items-center justify-between gap-3 border-l-[3px] border-line py-1 pl-3">
                  <span className="text-sm text-ink">Extend everyone on all-day positions to the new day</span>
                  <Toggle checked={extend} onChange={setExtend} label="Extend everyone on all-day positions to the new day" disabled={busy} />
                </div>
                {error && <p className="text-xs text-danger mb-3">{error}</p>}
                <div className="flex flex-col gap-2">
                  <Button className="w-full py-3" onClick={() => addDay(false)} disabled={busy}>
                    {busy ? 'Adding…' : 'Add Day'}
                  </Button>
                  <Button variant="ghost" className="w-full py-2" onClick={() => setAsking(false)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted mb-5">
                  The new day gets the same rooms. You can bring the crew roster across too.
                </p>
                {error && <p className="text-xs text-danger mb-3">{error}</p>}
                <div className="flex flex-col gap-2">
                  <Button className="w-full py-3" onClick={() => addDay(true)} disabled={busy}>
                    {busy ? 'Adding…' : 'Add Day & Copy Crew'}
                  </Button>
                  <Button variant="ghost" className="w-full py-3" onClick={() => addDay(false)} disabled={busy}>
                    Add Day (Empty)
                  </Button>
                  <Button variant="ghost" className="w-full py-2" onClick={() => setAsking(false)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* No-crew path has no dialog, so surface any failure inline. */}
      {!asking && error && <p className="text-xs text-danger mt-1">{error}</p>}

      {/* The dialog closes as soon as the day is added; the notice about who
          it extended lives outside it so closing the dialog doesn't hide it.
          Floated (see the wrapper above) rather than in normal flow. */}
      {extended.length > 0 && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] border-2 border-ink bg-surface p-3 shadow-edge">
          <CrewChangeNotice showId={showId} people={extended} onDone={() => { setExtended([]); router.refresh() }} />
        </div>
      )}
    </span>
  )
}
