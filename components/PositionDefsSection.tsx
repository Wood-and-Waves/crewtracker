'use client'

import { useEffect, useRef, useState } from 'react'
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
  showId, roomNames, roles, days, defs: initialDefs, flags, locked, organizationId,
}: {
  showId: string
  /** Room NAMES across the show (a room is a per-day row; the definition is keyed by name). */
  roomNames: string[]
  roles: string[]
  days: GridDay[]
  defs: DefRow[]
  flags: SlotFlag[]
  locked: boolean
  /** Lets the role picker add a role that is not on the list yet. */
  organizationId?: string
}) {
  const router = useRouter()
  const supabase = createClient()
  // roomKey === room name here: names are unique per show by construction.
  const rooms = roomNames.map(n => ({ key: n, name: n }))
  const [defs, setDefs] = useState<PositionDef[]>(() => initialDefs.map(r => toDef(r, r.room_name)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // PAINT FIRST, SAVE A BEAT LATER — the tracker's punch rule, applied here.
  //
  // Every tap used to be its own write plus a router.refresh(), and a custom
  // date is tapped a handful of times in a row: picking four days out of six
  // was four writes and four full page refreshes, each one re-rendering the
  // section under the cursor. Dan, 2026-09-17: "when I remove a day in custom
  // days, it reloads and jumps each time. That is not great." Worse, the old
  // guard returned early while a write was in flight, so a tap during that
  // window did not even paint — the day simply did not respond.
  //
  // Now the tap paints immediately and the write follows once the tapping
  // stops. The refresh — which is what the flags and the tracker's open rows
  // need — happens once at the end instead of once per tap.
  const SAVE_AFTER_MS = 600
  /** What the database holds, as far as we know. The diff is against THIS, not
   *  against whatever is on screen, because the screen is now ahead of it. */
  const savedRef = useRef<PositionDef[]>(initialDefs.map(r => toDef(r, r.room_name)))
  const pendingRef = useRef<PositionDef[] | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)

  // A server refresh replaces the list — but only when nothing of ours is in
  // flight, or it would overwrite edits that have not been written yet.
  useEffect(() => {
    if (pendingRef.current || savingRef.current) return
    const fresh = initialDefs.map(r => toDef(r, r.room_name))
    savedRef.current = fresh
    setDefs(fresh)
  }, [initialDefs])

  // Best effort on the way out: a change made in the last beat before leaving
  // still gets written, it just cannot be awaited.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (pendingRef.current) void flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onChange(next: PositionDef[]) {
    if (locked) return
    setError('')
    setDefs(next)                       // paint
    pendingRef.current = next
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flush() }, SAVE_AFTER_MS)
  }

  // Diff the pending list against the saved one and write the difference.
  // Then the sync, then a refresh so the flags and the tracker's open rows
  // catch up. Definition ids are the row ids; a new row has a client uuid until
  // its insert returns, so the returned id is written back into every list that
  // still holds the temporary one.
  async function flush() {
    if (savingRef.current) return       // the run in flight will pick this up
    const next = pendingRef.current
    if (!next) return
    pendingRef.current = null
    savingRef.current = true
    setBusy(true)
    const before = savedRef.current
    try {
      const beforeById = new Map(before.map(d => [d.key, d]))
      const nextById = new Map(next.map(d => [d.key, d]))
      const settled: PositionDef[] = []
      for (const d of next) {
        const was = beforeById.get(d.key)
        if (!d.role.trim()) { settled.push(d); continue }   // a row still being filled in
        const row = {
          show_id: showId, room_name: d.roomKey, role: d.role.trim(), count: d.count,
          day_kind: d.dayKind, custom_dates: d.dayKind === 'custom' ? d.customDates : null,
          sort_order: next.indexOf(d),
        }
        if (!was) {
          const { data, error } = await supabase.from('position_defs').insert(row).select('id')
          if (error || !data?.length) throw new Error(error?.message ?? 'That did not save.')
          const id = data[0].id as string
          settled.push({ ...d, key: id })
          setDefs(cur => cur.map(x => x.key === d.key ? { ...x, key: id } : x))
          // Read through a typed local: the compiler narrowed the ref to null
          // at the top of this function and cannot see that an await may have
          // let another tap refill it.
          const queued = pendingRef.current as PositionDef[] | null
          if (queued) pendingRef.current = queued.map(x => x.key === d.key ? { ...x, key: id } : x)
        } else {
          if (JSON.stringify(was) !== JSON.stringify(d)) {
            const { data, error } = await supabase.from('position_defs').update(row).eq('id', d.key).select('id')
            if (error || !data?.length) throw new Error(error?.message ?? 'That did not save.')
          }
          settled.push(d)
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
      savedRef.current = settled
      // Only when the tapping has actually stopped: a refresh mid-run is the
      // thing that was moving the page under the cursor.
      if (!pendingRef.current) router.refresh()
    } catch (e: any) {
      pendingRef.current = null
      setDefs(before)
      setError(e.message)
    } finally {
      savingRef.current = false
      setBusy(false)
      if (pendingRef.current) void flush()
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
      <p className="mb-3 flex items-baseline justify-between gap-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">
        <span>Positions</span>
        {busy && <span className="font-sans text-[11px] font-normal normal-case tracking-normal text-muted">Saving…</span>}
      </p>
      <p className="mb-3 text-xs text-muted">
        What each room needs, and on which kinds of day. The days come from the day activities above; change those and the open positions follow.
      </p>
      {roomNames.length === 0 ? (
        <p className="py-2 text-xs text-muted">Add a room on the tracker first.</p>
      ) : (
        <PositionDefsEditor rooms={rooms} roles={roles} days={days} defs={defs} onChange={onChange} organizationId={organizationId} readOnly={locked} />
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
