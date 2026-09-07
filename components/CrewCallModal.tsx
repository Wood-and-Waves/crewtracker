'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'
import Select from '@/components/ui/Select'
import Toggle from '@/components/ui/Toggle'
import FillPositionPicker from '@/components/FillPositionPicker'
import CallLinesEditor, { type CallLine } from '@/components/CallLinesEditor'
import { expandLines } from '@/lib/crewCallGrid'

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
  timecardId: string | null
  crewMemberId: string | null
  /** 'work' | 'travel' | 'travel+work' — what this day is for this person. */
  travel: 'work' | 'travel' | 'travel+work'
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
  const [newLines, setNewLines] = useState<CallLine[]>([])
  const [applyAll, setApplyAll] = useState(true)
  const [laterDays, setLaterDays] = useState<string[]>([])
  const [dayDate, setDayDate] = useState('')
  const [showId, setShowId] = useState('')
  const [ask, setAsk] = useState<{ smsText: string; link: string; warning?: string; emailed: boolean; name: string } | null>(null)
  const [copied, setCopied] = useState(false)
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
          .select('id, role, note, timecards(id, crew_member_id, crew_member_name, booking_status, is_travel_day, travel_in_day, travel_out_day)')
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
        timecardId: live?.id ?? null,
        crewMemberId: live?.crew_member_id ?? null,
        travel: live?.is_travel_day ? 'travel'
          : (live?.travel_in_day || live?.travel_out_day) ? 'travel+work'
          : 'work',
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
        setShowId(wd.show_id)
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
    if (newLines.length === 0 || busy) return
    setBusy(true)
    setError('')

    // One row per position, never role-plus-quantity: two stagehands is two
    // rows so each is individually open or filled. Every line the person
    // stacked up commits in a single insert — the call is one decision.
    const targets = applyAll ? [roomId, ...laterDays] : [roomId]

    // sort_order continues from what EACH target room already holds, read from
    // the database rather than assumed.
    //
    // This used to start one counter at this room's position count and reuse it
    // for the fan-out rooms too, so a later day that already had positions got
    // the new rows numbered among its existing ones — and .order('sort_order')
    // then resolved those ties arbitrarily, shuffling a room's call day to day.
    // StaffRoomModal learned the same lesson twice: re-query, never trust a
    // count carried over from somewhere else.
    const { data: existing, error: countError } = await supabase
      .from('crew_call_positions')
      .select('room_id, sort_order')
      .in('room_id', targets)
    if (countError) { setBusy(false); setError(countError.message); return }

    const nextOrder = new Map<string, number>()
    for (const row of (existing ?? []) as { room_id: string; sort_order: number }[]) {
      nextOrder.set(row.room_id, Math.max(nextOrder.get(row.room_id) ?? 0, row.sort_order + 1))
    }

    const rows = targets.flatMap(rid =>
      // expandLines is the shared quantity -> one-row-per-person expansion, the
      // same one plannedPositions uses for New Show.
      expandLines(newLines, nextOrder.get(rid) ?? 0).map(p => ({
        room_id: rid,
        role: p.role,
        sort_order: p.sortOrder,
      })),
    )

    const { error: e } = await supabase.from('crew_call_positions').insert(rows)
    setBusy(false)
    if (e) { setError(e.message); return }

    setNewLines([])
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

  // Travel is set when the booking is MADE, not discovered on site: it changes
  // what is being asked of the person, and the request email says so.
  //
  // travel_in vs travel_out: the last day of the room's run is an out-leg,
  // anything else an in-leg. Both are additive to that day's hours and payroll
  // treats them symmetrically, so the distinction is descriptive rather than
  // load-bearing — but guessing the wrong one would still read oddly.
  async function setTravel(timecardId: string, next: 'work' | 'travel' | 'travel+work') {
    setBusy(true)
    setError('')
    const isLastDay = laterDays.length === 0
    const { error: e } = await supabase.from('timecards').update({
      is_travel_day: next === 'travel',
      travel_in_day: next === 'travel+work' && !isLastDay,
      travel_out_day: next === 'travel+work' && isLastDay,
    }).eq('id', timecardId)
    setBusy(false)
    if (e) { setError(e.message); return }
    await reload()
    router.refresh()
  }

  // Ask them to confirm. Returns the text-message version too: a scheduler
  // often knows somebody answers texts and not email, and both go out from the
  // same action rather than being alternatives.
  async function askCrew(crewMemberId: string, name: string) {
    setBusy(true); setError(''); setCopied(false)
    const res = await fetch('/api/bookings/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, crewMemberId }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(body.error || 'Could not send the request.'); return }
    setAsk({ smsText: body.smsText, link: body.link, warning: body.warning, emailed: !!body.emailed, name })
    await reload()
    router.refresh()
  }

  // Most replies come back by phone, not through the link.
  async function recordAnswer(crewMemberId: string, response: 'confirmed' | 'declined') {
    setBusy(true); setError('')
    const res = await fetch('/api/bookings/record', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, crewMemberId, response }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(body.error || 'Could not record that.'); return }
    await reload()
    router.refresh()
  }

  async function reload() {
    const { data } = await supabase
      .from('crew_call_positions')
      .select('id, role, note, timecards(id, crew_member_id, crew_member_name, booking_status, is_travel_day, travel_in_day, travel_out_day)')
      .eq('room_id', roomId)
      .order('sort_order')
    setPositions((data ?? []).map((p: any) => {
      const live = (p.timecards ?? []).find((t: any) => t.booking_status !== 'declined')
      return {
        id: p.id, role: p.role, note: p.note,
        filledBy: live?.crew_member_name ?? null,
        status: live?.booking_status ?? null,
        timecardId: live?.id ?? null,
        crewMemberId: live?.crew_member_id ?? null,
        travel: live?.is_travel_day ? 'travel'
          : (live?.travel_in_day || live?.travel_out_day) ? 'travel+work'
          : 'work',
      }
    }))
  }

  if (!open) return null

  const filled = positions.filter(p => p.filledBy).length

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-card border border-line bg-surface p-5 sm:rounded-card">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Positions</h2>
          <span className="text-sm text-muted">{roomName}</span>
        </div>
        <p className="mb-4 text-xs text-muted">
          The roles this room needs on this day. The scheduler fills them.
        </p>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Chip tone={positions.length === 0 ? 'neutral' : filled === positions.length ? 'good' : 'ot'}>
                {positions.length === 0 ? 'No positions yet' : `${filled} of ${positions.length} filled`}
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
                      {p.filledBy && p.crewMemberId && !locked && p.status === 'pencilled' && (
                        <button
                          onClick={() => askCrew(p.crewMemberId!, p.filledBy!)}
                          disabled={busy}
                          className="rounded-field px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-wash disabled:opacity-40"
                        >
                          Ask
                        </button>
                      )}
                      {/* Answers usually arrive by phone; recording one has to
                          be as quick as reading it out. */}
                      {p.filledBy && p.crewMemberId && !locked && p.status === 'invited' && (
                        <>
                          <button
                            onClick={() => recordAnswer(p.crewMemberId!, 'confirmed')}
                            disabled={busy}
                            title="They said yes"
                            className="rounded-field px-2 py-1 text-xs font-semibold text-good hover:bg-surface-2 disabled:opacity-40"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => recordAnswer(p.crewMemberId!, 'declined')}
                            disabled={busy}
                            title="They said no"
                            className="rounded-field px-2 py-1 text-xs font-semibold text-danger hover:bg-surface-2 disabled:opacity-40"
                          >
                            No
                          </button>
                        </>
                      )}
                      {p.filledBy && p.timecardId && !locked && (
                        <Select
                          ariaLabel={`What kind of day this is for ${p.filledBy}`}
                          size="sm"
                          className="w-32"
                          value={p.travel}
                          onChange={v => setTravel(p.timecardId!, v as any)}
                          disabled={busy}
                          options={[
                            { value: 'work', label: 'Work' },
                            { value: 'travel', label: 'Travel' },
                            { value: 'travel+work', label: 'Travel + work' },
                          ]}
                        />
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

            {ask && (
              <div className="mb-4 rounded-field border border-line bg-surface-2 p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {ask.emailed ? `Emailed ${ask.name}` : `Ready to send to ${ask.name}`}
                  </p>
                  <button onClick={() => setAsk(null)} className="text-xs text-muted hover:text-ink">Close</button>
                </div>
                {ask.warning && <p className="mb-2 text-xs text-ot">{ask.warning}</p>}
                {/* For texting. No link in it on purpose — an action-link by SMS
                    is indistinguishable from a phishing message. */}
                <p className="mb-2 whitespace-pre-wrap rounded-field border border-line bg-surface p-2 text-xs text-ink">
                  {ask.smsText}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm" variant="ghost" className="flex-1"
                    onClick={() => {
                      navigator.clipboard?.writeText(ask.smsText)
                      setCopied(true)
                    }}
                  >
                    {copied ? 'Copied' : 'Copy message'}
                  </Button>
                  <a href={`sms:&body=${encodeURIComponent(ask.smsText)}`} className="flex-1">
                    <Button size="sm" className="w-full">Text</Button>
                  </a>
                </div>
              </div>
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
                <CallLinesEditor roles={roles} lines={newLines} onChange={setNewLines} />

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
                  disabled={newLines.length === 0 || busy}
                >
                  {busy ? 'Adding…' : (() => {
                    const n = newLines.reduce((t, l) => t + l.quantity, 0)
                    return n === 0 ? 'Add positions' : `Add ${n} position${n === 1 ? '' : 's'}`
                  })()}
                </Button>
              </div>
            )}

            {locked && (
              <p className="rounded-field border border-line px-3 py-2 text-xs text-muted">
                This show is finalized, so its positions are read-only. An admin or the show’s PM can unlock it.
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
