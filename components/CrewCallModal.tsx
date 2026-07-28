'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'
import Toggle from '@/components/ui/Toggle'
import FillPositionPicker from '@/components/FillPositionPicker'

// The crew call for one room on one day: the positions the show NEEDS.
//
// Distinct from staffing, which is who fills them. Whoever builds the show
// writes the call; the scheduler works it afterwards. Keeping the two apart is
// what lets the schedule say a day is short rather than only saying who is on
// it.
//
// SELF-CONTAINED BY DESIGN. Everything it needs is derived from roomId — the
// show, the date, the later days, the org's roles. That avoids threading four
// more props through the show page and the mobile tracker for a panel that is
// opened on demand, and it means the data is fetched when the modal opens
// rather than captured at page render. StaffRoomModal carries a comment about
// exactly this: props that covered only the active day went stale and produced
// duplicate timecards twice.

type Position = {
  id: string
  role: string
  note: string | null
  filledBy: string | null
  /** pencilled | invited | confirmed — null when the position is open. */
  status: string | null
}

export default function CrewCallModal({
  roomId,
  roomName,
  open,
  onClose,
  locked = false,
}: {
  roomId: string
  roomName: string
  open: boolean
  onClose: () => void
  /** Show is finalized: the call is read-only, enforced by a trigger too. */
  locked?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [positions, setPositions] = useState<Position[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [applyAll, setApplyAll] = useState(true)
  const [laterDays, setLaterDays] = useState<string[]>([])
  const [dayDate, setDayDate] = useState('')
  const [filling, setFilling] = useState<{ id: string; role: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')

    ;(async () => {
      // The call as it stands, with who is on each position. A declined person
      // does not hold a position — the database enforces one live occupant —
      // so they must not show as filling it here either.
      const [{ data: pos, error: posErr }, { data: roleRows }, { data: room }] = await Promise.all([
        supabase
          .from('crew_call_positions')
          .select('id, role, note, timecards(crew_member_name, booking_status)')
          .eq('room_id', roomId)
          .order('sort_order'),
        supabase.from('av_roles').select('name').order('sort_order'),
        supabase.from('rooms').select('name, work_days!inner(show_id, date)').eq('id', roomId).single(),
      ])
      if (!active) return

      if (posErr) {
        setError(posErr.message)
        setLoading(false)
        return
      }

      setPositions((pos ?? []).map((p: any) => {
        const live = (p.timecards ?? []).find((t: any) => t.booking_status !== 'declined')
        return {
        id: p.id, role: p.role, note: p.note,
        filledBy: live?.crew_member_name ?? null,
        status: live?.booking_status ?? null,
      }
      }))
      setRoles((roleRows ?? []).map((r: any) => r.name))

      // Which rooms of the same name exist on LATER days of this show. That is
      // what "apply to all remaining days" means, and it is derived rather than
      // assumed — a room only exists on the days somebody created it on.
      const wd: any = Array.isArray((room as any)?.work_days)
        ? (room as any).work_days[0]
        : (room as any)?.work_days
      if (wd) {
        setDayDate(wd.date)
        const { data: siblings } = await supabase
          .from('rooms')
          .select('id, work_days!inner(date, show_id)')
          .eq('name', (room as any).name)
          .eq('work_days.show_id', wd.show_id)
          .gt('work_days.date', wd.date)
        if (active) setLaterDays((siblings ?? []).map((r: any) => r.id))
      }
      setLoading(false)
    })()

    return () => { active = false }
  }, [open, roomId])

  async function addPositions() {
    if (!role || busy) return
    setBusy(true)
    setError('')

    // One row per position, never role-plus-quantity: two stagehands is two
    // rows so each is individually open or filled.
    const targets = applyAll ? [roomId, ...laterDays] : [roomId]
    const base = positions.length
    const rows = targets.flatMap(rid =>
      Array.from({ length: quantity }, (_, i) => ({
        room_id: rid,
        role,
        sort_order: base + i,
      })),
    )

    const { error: e } = await supabase.from('crew_call_positions').insert(rows)
    setBusy(false)
    if (e) { setError(e.message); return }

    setQuantity(1)
    await reload()
    router.refresh()
  }

  async function removePosition(id: string, filledBy: string | null) {
    if (busy) return
    if (filledBy && !confirm(
      `${filledBy} is on this position. Removing it keeps them on the show as an extra, not against a position. Continue?`
    )) return

    setBusy(true)
    // ON DELETE SET NULL on timecards.call_position_id: removing a position
    // never deletes somebody's timecard, which may already carry punches.
    const { error: e } = await supabase.from('crew_call_positions').delete().eq('id', id)
    setBusy(false)
    if (e) { setError(e.message); return }
    await reload()
    router.refresh()
  }

  async function reload() {
    const { data } = await supabase
      .from('crew_call_positions')
      .select('id, role, note, timecards(crew_member_name, booking_status)')
      .eq('room_id', roomId)
      .order('sort_order')
    setPositions((data ?? []).map((p: any) => {
      const live = (p.timecards ?? []).find((t: any) => t.booking_status !== 'declined')
      return {
        id: p.id, role: p.role, note: p.note,
        filledBy: live?.crew_member_name ?? null,
        status: live?.booking_status ?? null,
      }
    }))
  }

  if (!open) return null

  const filled = positions.filter(p => p.filledBy).length

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-card border border-line bg-surface p-5 sm:rounded-card">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Crew call</h2>
          <span className="text-sm text-muted">{roomName}</span>
        </div>
        <p className="mb-4 text-xs text-muted">
          What this room needs on this day. The scheduler fills these.
        </p>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Chip tone={positions.length === 0 ? 'neutral' : filled === positions.length ? 'good' : 'ot'}>
                {positions.length === 0 ? 'No call yet' : `${filled} of ${positions.length} filled`}
              </Chip>
            </div>

            {positions.length > 0 && (
              <ul className="mb-4 divide-y divide-line rounded-field border border-line">
                {positions.map(p => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{p.role}</div>
                      <div className="truncate text-xs text-muted">
                        {p.filledBy ?? 'Open'}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.filledBy
                        // 'pencilled' is penned in, nobody asked yet — showing
                        // it as plain "Filled" is what makes people get asked
                        // twice or not at all.
                        ? <Chip tone={p.status === 'confirmed' ? 'good' : 'neutral'}>
                            {p.status === 'confirmed' ? 'Confirmed'
                              : p.status === 'invited' ? 'Asked'
                              : 'Pencilled'}
                          </Chip>
                        : <Chip tone="ot">Open</Chip>}
                      {!p.filledBy && !locked && (
                        <button
                          onClick={() => setFilling({ id: p.id, role: p.role })}
                          className="rounded-field px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-wash"
                        >
                          Fill
                        </button>
                      )}
                      {!locked && (
                        <button
                          onClick={() => removePosition(p.id, p.filledBy)}
                          disabled={busy}
                          className="rounded-field px-2 py-1 text-xs text-danger hover:bg-surface-2 disabled:opacity-40"
                          aria-label={`Remove ${p.role} position`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {filling && dayDate && (
              <div className="mb-4">
                <FillPositionPicker
                  positionId={filling.id}
                  positionRole={filling.role}
                  roomId={roomId}
                  date={dayDate}
                  onCancel={() => setFilling(null)}
                  onFilled={async () => {
                    setFilling(null)
                    await reload()
                    router.refresh()
                  }}
                />
              </div>
            )}

            {!locked && !filling && (
              <div className="rounded-field border border-line p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  Add positions
                </p>
                <div className="flex gap-2">
                  {/* key tied to the options list: iPad Safari has a hydration
                      bug that duplicates <option> in a controlled <select>. */}
                  <select
                    key={roles.join(',')}
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    className="min-w-0 flex-1 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value="" className="bg-surface-2 text-ink">Choose a role…</option>
                    {roles.map(r => (
                      <option key={r} value={r} className="bg-surface-2 text-ink">{r}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={quantity}
                    onChange={e => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    aria-label="How many"
                    className="w-16 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                </div>

                {laterDays.length > 0 && (
                  <label className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-ink">
                      Also add to the next {laterDays.length} day{laterDays.length === 1 ? '' : 's'}
                    </span>
                    <Toggle checked={applyAll} onChange={setApplyAll} />
                  </label>
                )}

                <Button
                  className="mt-3 w-full"
                  size="sm"
                  onClick={addPositions}
                  disabled={!role || busy}
                >
                  {busy ? 'Adding…' : `Add ${quantity} position${quantity === 1 ? '' : 's'}`}
                </Button>
              </div>
            )}

            {locked && (
              <p className="rounded-field border border-line px-3 py-2 text-xs text-muted">
                This show is finalized, so its call is read-only. An admin can unlock it.
              </p>
            )}
          </>
        )}

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <Button variant="ghost" className="mt-4 w-full" onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
