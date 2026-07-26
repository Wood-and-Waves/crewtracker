'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/datetime'
import Button from '@/components/ui/Button'

// Extends a show by one day, cloning the last day's rooms and optionally its
// crew. Extracted from EditShowClient so the tracker's day switcher and Edit
// Show share one implementation — iOS offers this in both places, with a
// three-way "Add Day & Copy Crew" / "Add Day (Empty)" / Cancel choice.

type WorkDay = { id: string; date: string; day_number: number }
type Room = { id: string; name: string; work_day_id: string }

export default function AddDayButton({
  showId,
  endDate,
  workDays,
  rooms,
  hasCrew,
  variant = 'button',
}: {
  showId: string
  endDate: string
  workDays: WorkDay[]
  rooms: Room[]
  /** Whether the last day has any crew — decides if copying is offered. */
  hasCrew: boolean
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

  function open() {
    setError('')
    if (hasCrew) setAsking(true)
    else addDay(false)
  }

  async function addDay(copyCrew: boolean) {
    setBusy(true)
    setError('')

    const sorted = [...workDays].sort((a, b) => a.date.localeCompare(b.date))
    const lastDay = sorted[sorted.length - 1]
    if (!lastDay) { setBusy(false); setError('This show has no days to extend.'); return }

    const next = new Date(lastDay.date + 'T00:00:00')
    next.setDate(next.getDate() + 1)
    // Local calendar date, never the UTC one — see localDateStr.
    const nextDateStr = localDateStr(next)

    if (nextDateStr > endDate) {
      const { error: e } = await supabase.from('shows').update({ end_date: nextDateStr }).eq('id', showId)
      if (e) { setBusy(false); setError(e.message); return }
    }

    const { data: newDay, error: dayError } = await supabase
      .from('work_days')
      .insert({ show_id: showId, date: nextDateStr, day_number: lastDay.day_number + 1 })
      .select()
      .single()
    if (dayError || !newDay) { setBusy(false); setError(dayError?.message || 'Could not add the day.'); return }

    // Clone the rooms, nudging created_at so the new day lists them in the same
    // order as the day they came from (the tracker orders rooms by created_at).
    const sourceRooms = rooms
      .filter(r => r.work_day_id === lastDay.id)
      .sort((a, b) => a.name.localeCompare(b.name))
    let newRooms: Room[] = []
    if (sourceRooms.length > 0) {
      const { data, error: roomError } = await supabase
        .from('rooms')
        .insert(sourceRooms.map((r, i) => ({
          work_day_id: newDay.id,
          name: r.name,
          created_at: new Date(Date.now() + i).toISOString(),
        })))
        .select()
      if (roomError) { setBusy(false); setError(roomError.message); return }
      newRooms = (data || []) as Room[]
    }

    if (copyCrew && newRooms.length > 0) {
      // No day_rate: the BEFORE INSERT trigger inherits the show's rate for this
      // (crew member, role) — sourced from the very row being copied, which is on
      // the same show — so reading it here would be redundant and the trigger
      // would override it anyway. See scripts/sql/show-wide-day-rate.sql.
      const { data: oldTimecards, error: tcReadError } = await supabase
        .from('timecards')
        .select('room_id, crew_member_id, crew_member_name, role')
        .in('room_id', sourceRooms.map(r => r.id))
      if (tcReadError) { setBusy(false); setError(tcReadError.message); return }

      const rows: any[] = []
      for (const oldTc of oldTimecards || []) {
        const from = sourceRooms.find(r => r.id === oldTc.room_id)
        const to = newRooms.find(nr => nr.name === from?.name)
        if (!to) continue
        rows.push({
          room_id: to.id,
          crew_member_id: oldTc.crew_member_id,
          crew_member_name: oldTc.crew_member_name,
          role: oldTc.role,
        })
      }
      if (rows.length > 0) {
        const { error: insError } = await supabase.from('timecards').insert(rows)
        if (insError) { setBusy(false); setError(insError.message); return }
      }
    }

    setBusy(false)
    setAsking(false)
    router.refresh()
  }

  return (
    <>
      {variant === 'circle' ? (
        <button
          onClick={open}
          disabled={busy}
          aria-label="Add another day"
          title="Add another day to this show"
          className="rounded-full bg-accent text-accent-ink h-9 w-9 flex items-center justify-center shrink-0 text-lg leading-none disabled:opacity-50"
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
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-1">Add Next Day?</h2>
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
          </div>
        </div>
      )}

      {/* No-crew path has no dialog, so surface any failure inline. */}
      {!asking && error && <p className="text-xs text-danger mt-1">{error}</p>}
    </>
  )
}
