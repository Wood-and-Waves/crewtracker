'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { liveBookings } from '@/lib/timecardFields'
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

type Candidate = {
  id: string
  name: string
  roles: string[]
  /** Where they are already committed on this date, within this organization. */
  conflicts: { showName: string; roomName: string; sameRoom: boolean }[]
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

  async function fill(c: Candidate) {
    if (busy) return
    setBusy(true)
    setError('')

    // 'pencilled': penned in, not yet asked. day_rate is deliberately not sent —
    // a trigger sets the show-wide rate for (show, person, role), and the write
    // guard drops any rate supplied by someone without permission anyway.
    const { error: e } = await supabase.from('timecards').insert({
      room_id: roomId,
      crew_member_id: c.id,
      crew_member_name: c.name,
      role: positionRole,
      call_position_id: positionId,
      booking_status: 'pencilled',
    })
    setBusy(false)

    if (e) {
      // 23505 = the partial unique index: somebody else filled this position
      // between the list loading and this click.
      setError(e.code === '23505'
        ? 'Somebody already filled this position. Close and reopen the call to see who.'
        : e.message)
      return
    }
    onFilled()
  }

  return (
    <div className="rounded-field border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Fill · {positionRole}
        </p>
        <button onClick={onCancel} className="text-xs text-muted hover:text-ink">Cancel</button>
      </div>

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

      {loading ? (
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
