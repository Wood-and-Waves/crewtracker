'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { liveBookings } from '@/lib/timecardFields'

// iOS offers "Copy Crew from Day N" on any empty roster past day 1
// (copyCrewFromPreviousDay). Without it, staffing a new day means re-picking
// everyone from the directory one at a time.
//
// Copies the same-named room's roster from the previous day. Anyone already on
// this room is skipped; the timecards_room_crew_uniq index is the backstop.

export default function CopyCrewButton({
  targetRoomId,
  sourceRoomId,
  sourceDayNumber,
  count,
  locked = false,
}: {
  targetRoomId: string
  sourceRoomId: string
  sourceDayNumber: number
  count: number
  /** Show is finalized: copying crew inserts timecards, which are refused. */
  locked?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function copy() {
    setBusy(true)
    setError('')

    // No day_rate: the BEFORE INSERT trigger inherits the show's rate for this
    // (crew member, role) from the source row itself, which is on the same show.
    // See scripts/sql/applied/show-wide-day-rate.sql.
    // Declined excluded. A decline updates every one of that person's timecards
    // on the show, so copying the source day forward unfiltered would resurrect
    // them on the new day as 'pencilled' — re-creating the bug one day later.
    const { data: source, error: srcError } = await liveBookings(supabase
      .from('timecards')
      .select('crew_member_id, crew_member_name, role')
      .eq('room_id', sourceRoomId))

    if (srcError) { setBusy(false); setError(srcError.message); return }
    if (!source || source.length === 0) { setBusy(false); setError('That day has no crew to copy.'); return }

    // Who's already here — so a re-run can't double anyone up.
    // DELIBERATELY UNFILTERED, unlike the source read above: timecards_room_crew_uniq
    // is (room_id, crew_member_id) with no booking_status predicate, so a declined
    // row still occupies that slot. Hiding it here would mean attempting an insert
    // the database rejects with 23505.
    const { data: existing, error: exError } = await supabase
      .from('timecards')
      .select('crew_member_id')
      .eq('room_id', targetRoomId)

    if (exError) { setBusy(false); setError(exError.message); return }
    const taken = new Set((existing || []).map(e => e.crew_member_id).filter(Boolean))

    // Rows with no crew_member_id are manually-named crew and can't be matched,
    // so they always copy across.
    const rows = source
      .filter(s => !s.crew_member_id || !taken.has(s.crew_member_id))
      .map(s => ({
        room_id: targetRoomId,
        crew_member_id: s.crew_member_id,
        crew_member_name: s.crew_member_name,
        role: s.role,
      }))

    if (rows.length === 0) { setBusy(false); setError('Everyone from that day is already here.'); return }

    const { error: insError } = await supabase.from('timecards').insert(rows)
    setBusy(false)
    if (insError) { setError(insError.message); return }
    router.refresh()
  }

  return (
    <div className="p-4">
      <button
        onClick={copy}
        disabled={busy || locked}
        title={locked ? 'Times are locked — the final report has been sent.' : undefined}
        className="w-full rounded-field bg-accent-wash px-3 py-2 text-sm font-medium text-accent transition hover:opacity-80 disabled:opacity-50"
      >
        {busy ? 'Copying…' : `Copy ${count} crew from Day ${sourceDayNumber}`}
      </button>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
