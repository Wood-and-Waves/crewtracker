'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PositionDefsEditor from '@/components/PositionDefsEditor'
import CrewChangeNotice from '@/components/CrewChangeNotice'
import SlotFlagActions from '@/components/SlotFlagActions'
import type { SlotFlag } from '@/lib/scheduleBoard'
import type { DayKind, GridDay, PositionDef } from '@/lib/positionDefs'

// Edit Show → Positions (piece B of the 2026-09-07 show-flow spec).
//
// The definitions are the truth ("2 stagehands, Ballroom, load-in and
// load-out"); the database derives the per-day slots from them and the day
// grid (sync_position_slots). Every change here is saved at once — a verified
// write — and then the sync runs, so open slots appear and unfilled slots go
// straight away. THE ONE RULE holds throughout: the app adds open slots
// freely and never removes a booked person. A booked slot whose day no longer
// fits is a FLAG, listed below the editor with three human choices.

export type DefRow = {
  id: string; room_name: string; role: string; count: number; day_kind: DayKind
  custom_dates: string[] | null; sort_order: number
}
// The flag row's shape lives with the board model now, so the grid and this
// list cannot drift apart. Re-exported: EditShowClient imports it from here.
export type { SlotFlag }

const toDef = (r: DefRow, roomKey: string): PositionDef => ({
  key: r.id, roomKey, role: r.role, count: r.count, dayKind: r.day_kind, customDates: r.custom_dates ?? [],
})

function fmt(date: string) {
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function PositionDefsSection({
  showId, roomNames, roles, days, defs: initialDefs, flags, locked,
}: {
  showId: string
  /** Room NAMES across the show (a room is a per-day row; the definition is keyed by name). */
  roomNames: string[]
  roles: string[]
  days: GridDay[]
  defs: DefRow[]
  flags: SlotFlag[]
  locked: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  // roomKey === room name here: names are unique per show by construction.
  const rooms = roomNames.map(n => ({ key: n, name: n }))
  const [defs, setDefs] = useState<PositionDef[]>(() => initialDefs.map(r => toDef(r, r.room_name)))
  useEffect(() => { setDefs(initialDefs.map(r => toDef(r, r.room_name))) }, [initialDefs])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Diff the editor's new list against the saved one and write the difference.
  // Then the sync, then a refresh so the flags and the tracker's open rows
  // catch up. Definition ids are the row ids; a new row has a client uuid until
  // its insert returns.
  async function onChange(next: PositionDef[]) {
    if (busy || locked) return
    setError('')
    const before = defs
    setDefs(next)
    setBusy(true)
    try {
      const beforeById = new Map(before.map(d => [d.key, d]))
      const nextById = new Map(next.map(d => [d.key, d]))
      for (const d of next) {
        const was = beforeById.get(d.key)
        if (!d.role.trim()) continue   // a row still being filled in
        const row = {
          show_id: showId, room_name: d.roomKey, role: d.role.trim(), count: d.count,
          day_kind: d.dayKind, custom_dates: d.dayKind === 'custom' ? d.customDates : null,
          sort_order: next.indexOf(d),
        }
        if (!was) {
          const { data, error } = await supabase.from('position_defs').insert(row).select('id')
          if (error || !data?.length) throw new Error(error?.message ?? 'That did not save.')
          setDefs(cur => cur.map(x => x.key === d.key ? { ...x, key: data[0].id } : x))
        } else if (JSON.stringify(was) !== JSON.stringify(d)) {
          const { data, error } = await supabase.from('position_defs').update(row).eq('id', d.key).select('id')
          if (error || !data?.length) throw new Error(error?.message ?? 'That did not save.')
        }
      }
      for (const d of before) {
        if (nextById.has(d.key)) continue
        // Deleting a definition: its UNFILLED slots go with the sync below; a
        // FILLED slot keeps its person and simply stops following the grid
        // (the FK sets position_def_id null — a custom one-off from now on).
        const { data, error } = await supabase.from('position_defs').delete().eq('id', d.key).select('id')
        if (error || !data?.length) throw new Error(error?.message ?? 'That did not delete.')
      }
      const { error: syncError } = await supabase.rpc('sync_position_slots', { p_show_id: showId })
      if (syncError) throw new Error(syncError.message)
      router.refresh()
    } catch (e: any) {
      setDefs(before)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- Flags: a booked person on a day that no longer fits -----------------
  // The three answers live in SlotFlagActions, shared with the Scheduling
  // screen's cells. Crew change notice: a move or a release changes what a
  // person's days look like, so both offer to tell them — never forced. Only
  // people with a crewMemberId can be told (the route emails by crew_members).
  const [changed, setChanged] = useState<{ id: string; name: string }[]>([])

  return (
    <section className="mb-6">
      <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Positions</p>
      <p className="mb-3 text-xs text-muted">
        What each room needs, and on which kinds of day. The days come from the day activities above; change those and the open positions follow.
      </p>
      {roomNames.length === 0 ? (
        <p className="py-2 text-xs text-muted">Add a room on the tracker first.</p>
      ) : (
        <PositionDefsEditor rooms={rooms} roles={roles} days={days} defs={defs} onChange={onChange} readOnly={locked || busy} />
      )}

      {flags.length > 0 && (
        <div className="mt-4 border-l-[3px] border-ot py-1 pl-3">
          <p className="text-sm font-semibold text-ink">
            {flags.length === 1 ? '1 booking no longer matches its days' : `${flags.length} bookings no longer match their days`}
          </p>
          <p className="mb-2 text-xs text-muted">The app never removes a booked person. Decide for each: move them to an open day, keep the day anyway, or release them.</p>
          <ul className="flex flex-col gap-2">
            {flags.map(f => (
              <li key={f.slot_id} className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <span>{f.crew_member_name} · {f.role} · {fmt(f.date)} · {f.room_name}</span>
                <span className="ml-auto">
                  <SlotFlagActions
                    showId={showId}
                    flag={f}
                    locked={locked || busy}
                    onChanged={p => setChanged(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p])}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {changed.length > 0 && (
        <div className="mt-4">
          <CrewChangeNotice showId={showId} people={changed} onDone={() => setChanged([])} />
        </div>
      )}
    </section>
  )
}
