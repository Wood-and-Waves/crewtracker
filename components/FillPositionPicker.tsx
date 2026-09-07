'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { liveBookings } from '@/lib/timecardFields'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'
import Toggle from '@/components/ui/Toggle'

// Choosing who fills one position on one day.
//
// The scheduler's core action. Three things it has to get right, all of them
// from how the work actually happens:
//
//   * FILTER BY ROLE, DON'T RESTRICT TO IT. The list defaults to people who
//     hold the position's role, because that is who you are looking for — but
//     the filter is a toggle, never a rule. People work outside their usual
//     role constantly and an app that forbids it just gets worked around.
//   * SHOW WHO IS ALREADY COMMITTED, on this date, before they are picked.
//     Booking someone already working elsewhere that day is the classic
//     scheduling error, and it is only avoidable if the clash is visible at the
//     moment of choosing rather than discovered later.
//   * NEVER ACROSS ORGANIZATIONS. Everything here is scoped by the caller's own
//     access, so a person who also works for another company through a separate
//     membership does not surface as busy. That is deliberate and is a hard rule
//     — see CLAUDE.md. Do not "improve" this by matching people across
//     companies on email or name.
//
// Filling writes booking_status 'pencilled': penned in, nobody contacted yet.
// Inviting them is a separate, later action, and conflating the two is how
// people get asked twice or never.
//
// A POSITION DEFINED "BY KIND OF DAY" (position_defs, migration 0034) runs on
// several days, and most of the time one person does the whole run. So when the
// clicked slot belongs to a definition, choosing a person opens a second step —
// their days: the definition's other OPEN slots, each ticked, to untick — and
// books every ticked day in ONE insert. A slot with no definition (built in the
// old per-day grid, or a one-off) behaves exactly as before: one day, no step.
// The picker finds the definition itself from the slot, so no caller has to
// know the difference.

type Candidate = {
  id: string
  name: string
  roles: string[]
  /** Where they are already committed on this date, within this organization. */
  conflicts: { showName: string; roomName: string; sameRoom: boolean }[]
}

/** Another open slot of the same definition, on another day. */
type SiblingSlot = { id: string; roomId: string; roomName: string; date: string }

function fmtDay(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function FillPositionPicker({
  positionId,
  positionRole,
  roomId,
  date,
  onFilled,
  onCancel,
}: {
  positionId: string
  positionRole: string
  roomId: string
  date: string
  onFilled: () => void
  onCancel: () => void
}) {
  const supabase = createClient()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [onlyRole, setOnlyRole] = useState(true)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The definition's other open days, if the slot has a definition.
  const [siblings, setSiblings] = useState<SiblingSlot[]>([])
  // Step two: the chosen person and which of those days stay ticked.
  const [plan, setPlan] = useState<{ c: Candidate; picked: Set<string> } | null>(null)
  // The show this position belongs to — the picker only ever knows roomId,
  // and logging a staffing event needs the show. Read once per room.
  const [showId, setShowId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setSiblings([])
    setPlan(null)
    ;(async () => {
      const [{ data: me }, { data: room }] = await Promise.all([
        supabase.from('crew_call_positions').select('position_def_id').eq('id', positionId).maybeSingle(),
        supabase.from('rooms').select('show_id').eq('id', roomId).maybeSingle(),
      ])
      if (active) setShowId((room as any)?.show_id ?? null)
      const defId = (me as any)?.position_def_id
      if (!defId || !active) return
      const { data: slots } = await supabase
        .from('crew_call_positions')
        .select('id, room_id, rooms!inner ( name, work_days!inner ( date ) )')
        .eq('position_def_id', defId)
        .neq('id', positionId)
      const ids = ((slots ?? []) as any[]).map(s => s.id)
      const { data: held } = ids.length
        ? await liveBookings(supabase.from('timecards').select('call_position_id, booking_status')).in('call_position_id', ids)
        : { data: [] as any[] }
      if (!active) return
      const taken = new Set(((held ?? []) as any[]).map(t => t.call_position_id))
      // ONE slot per room-day, and never the clicked slot's own room: a
      // definition that wants two stagehands has two open slots on each day,
      // and one person can hold only one of them (the room+person unique index
      // says so). The other slot stays open for the next person.
      const seenRoom = new Set<string>([roomId])
      setSiblings(((slots ?? []) as any[])
        .filter(s => !taken.has(s.id))
        .map(s => {
          const room = Array.isArray(s.rooms) ? s.rooms[0] : s.rooms
          const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
          return { id: s.id, roomId: s.room_id, roomName: room?.name ?? '', date: wd?.date ?? '' }
        })
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter(s => (seenRoom.has(s.roomId) ? false : (seenRoom.add(s.roomId), true))))
    })()
    return () => { active = false }
  }, [positionId, roomId])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      const [{ data: crew, error: crewErr }, { data: rates }, { data: booked }] = await Promise.all([
        supabase.from('crew_members').select('id, full_name').order('full_name'),
        // Roles come from rate cards — the only place the app records what a
        // person does. Someone with no rate card simply has no roles listed and
        // shows up when the filter is off.
        supabase.from('crew_rate_cards_visible').select('crew_member_id, role'),
        // Who is already on something this date. Scoped by RLS to this
        // organization's shows; see the header note.
        // A declined booking is not a commitment — the position is free and so
        // is the person, so they are not a same-day conflict.
        liveBookings(supabase
          .from('timecards')
          .select(`
            crew_member_id, booking_status, room_id,
            rooms!inner ( name, work_days!inner ( date, shows!inner ( name ) ) )
          `))
          .eq('rooms.work_days.date', date),
      ])
      if (!active) return

      if (crewErr) {
        setError(crewErr.message)
        setLoading(false)
        return
      }

      const rolesByCrew = new Map<string, string[]>()
      for (const r of (rates ?? []) as any[]) {
        if (!r.crew_member_id) continue
        rolesByCrew.set(r.crew_member_id, [...(rolesByCrew.get(r.crew_member_id) ?? []), r.role])
      }

      const conflictsByCrew = new Map<string, Candidate['conflicts']>()
      for (const t of (booked ?? []) as any[]) {
        if (!t.crew_member_id) continue
        const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
        const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
        const show = Array.isArray(wd?.shows) ? wd.shows[0] : wd?.shows
        if (!room || !show) continue
        conflictsByCrew.set(t.crew_member_id, [
          ...(conflictsByCrew.get(t.crew_member_id) ?? []),
          { showName: show.name, roomName: room.name, sameRoom: t.room_id === roomId },
        ])
      }

      setCandidates((crew ?? []).map((c: any) => ({
        id: c.id,
        name: c.full_name,
        roles: rolesByCrew.get(c.id) ?? [],
        conflicts: conflictsByCrew.get(c.id) ?? [],
      })))
      setLoading(false)
    })()
    return () => { active = false }
  }, [date, roomId])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return candidates.filter(c => {
      if (q && !c.name.toLowerCase().includes(q)) return false
      if (onlyRole && !c.roles.includes(positionRole)) return false
      return true
    })
  }, [candidates, onlyRole, search, positionRole])

  function fill(c: Candidate) {
    if (busy) return
    setError('')
    // A definition with other open days: ask which of them first.
    if (siblings.length > 0) {
      setPlan({ c, picked: new Set(siblings.map(s => s.id)) })
      return
    }
    void book(c, [])
  }

  async function book(c: Candidate, extra: SiblingSlot[]) {
    setBusy(true)
    setError('')

    // 'pencilled': penned in, not yet asked. day_rate is deliberately not sent —
    // a trigger sets the show-wide rate for (show, person, role), and the write
    // guard drops any rate supplied by someone without permission anyway.
    // One insert for every day: all of them land or none do.
    const rows = [{ room_id: roomId, call_position_id: positionId }, ...extra.map(s => ({ room_id: s.roomId, call_position_id: s.id }))]
      .map(r => ({
        ...r,
        crew_member_id: c.id,
        crew_member_name: c.name,
        role: positionRole,
        booking_status: 'pencilled',
      }))
    const { data, error: e } = await supabase.from('timecards').insert(rows).select('id')
    setBusy(false)

    if (e || !data?.length) {
      // 23505 = a unique index: either somebody else filled one of these
      // positions between the list loading and this click, or the person is
      // already in that room that day. Postgres names the clashing key, so say
      // which day rather than making them guess.
      setError(e?.code === '23505' ? clashMessage(e.details ?? '', c, extra) : (e?.message ?? 'That did not save.'))
      return
    }
    if (showId) {
      await logStaffingEvent(supabase, {
        showId,
        kind: 'booked',
        crewMemberId: c.id,
        crewMemberName: c.name,
        role: positionRole,
        days: compressDays([date, ...extra.map(s => s.date)]),
      })
    }
    onFilled()
  }

  function clashMessage(details: string, c: Candidate, extra: SiblingSlot[]) {
    const slot = /\(call_position_id\)=\(([0-9a-f-]+)\)/i.exec(details)?.[1]
    const room = /\(room_id, crew_member_id\)=\(([0-9a-f-]+),/i.exec(details)?.[1]
    const day = slot
      ? (slot === positionId ? date : extra.find(s => s.id === slot)?.date)
      : room
        ? (room === roomId ? date : extra.find(s => s.roomId === room)?.date)
        : undefined
    if (room) return `${c.name} is already in this room on ${day ? fmtDay(day) : 'one of these days'}. Untick that day and try again.`
    return `Somebody already filled ${day ? fmtDay(day) : 'one of these days'}. Close and reopen to see who.`
  }

  return (
    <div className="rounded-field border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Fill · {positionRole}
        </p>
        <button onClick={onCancel} className="text-xs text-muted hover:text-ink">Cancel</button>
      </div>

      {!plan && (
        <>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search crew…"
            className="mb-2 w-full rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />

          <label className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Only show {positionRole}s</span>
            <Toggle checked={onlyRole} onChange={setOnlyRole} />
          </label>
        </>
      )}

      {plan ? (
        <div>
          <p className="mb-1 text-sm font-semibold text-ink">{plan.c.name}&rsquo;s days</p>
          <p className="mb-2 text-xs text-muted">
            This position runs on {siblings.length + 1} days. Untick any {plan.c.name.split(' ')[0]} is not doing.
          </p>
          <ul className="divide-y divide-line rounded-field border border-line">
            <li className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm text-ink">{fmtDay(date)} <span className="text-xs text-muted">· this one</span></span>
              <Toggle checked disabled onChange={() => {}} label={`${fmtDay(date)}, always included`} />
            </li>
            {siblings.map(s => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm text-ink">{fmtDay(s.date)}</span>
                <Toggle
                  checked={plan.picked.has(s.id)}
                  disabled={busy}
                  label={fmtDay(s.date)}
                  onChange={on => setPlan(p => {
                    if (!p) return p
                    const picked = new Set(p.picked)
                    if (on) picked.add(s.id); else picked.delete(s.id)
                    return { ...p, picked }
                  })}
                />
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => book(plan.c, siblings.filter(s => plan.picked.has(s.id)))}>
              {busy ? 'Booking…' : `Book ${plan.picked.size + 1} day${plan.picked.size === 0 ? '' : 's'}`}
            </Button>
            <button type="button" className="text-xs text-muted hover:text-ink" disabled={busy} onClick={() => setPlan(null)}>Back</button>
          </div>
        </div>
      ) : loading ? (
        <p className="py-4 text-center text-sm text-muted">Loading crew…</p>
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">
          {onlyRole
            ? `Nobody in the directory is listed as ${positionRole}. Turn the filter off to see everyone.`
            : 'No crew match that search.'}
        </p>
      ) : (
        <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-field border border-line">
          {shown.map(c => {
            const sameRoom = c.conflicts.find(x => x.sameRoom)
            return (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{c.name}</div>
                  {c.conflicts.length > 0 && (
                    <div className="truncate text-[11px] text-ot">
                      {sameRoom
                        ? 'Already in this room today'
                        : `On ${c.conflicts.map(x => x.showName).join(', ')} today`}
                    </div>
                  )}
                  {c.conflicts.length === 0 && !c.roles.includes(positionRole) && (
                    <div className="truncate text-[11px] text-muted">
                      {c.roles.length ? c.roles.join(', ') : 'No roles listed'}
                    </div>
                  )}
                </div>
                {/* Booked elsewhere is a WARNING, never a block: a load-out on
                    one show and a rehearsal on another in one day is normal. */}
                <Button
                  size="sm"
                  variant={c.conflicts.length ? 'ghost' : 'primary'}
                  disabled={busy || !!sameRoom}
                  title={sameRoom ? 'They are already in this room today.' : undefined}
                  onClick={() => fill(c)}
                >
                  {sameRoom ? 'In room' : c.conflicts.length ? 'Book anyway' : 'Book'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
