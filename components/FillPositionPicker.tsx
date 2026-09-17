'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { liveBookings } from '@/lib/timecardFields'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'
import type { PaintedBooking } from '@/lib/scheduleBoard'
import { describeConflicts, type BookingConflict } from '@/lib/bookingConflicts'
import Button from '@/components/ui/Button'
import Toggle from '@/components/ui/Toggle'
import { cn } from '@/lib/cn'

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
// several days, and most of the time one person does the whole run — so
// CLICKING THEM BOOKS THE WHOLE RUN, every open day of the definition in ONE
// insert, and the row says how many days that is before you press it. Somebody
// doing only part of it is the exception and has its own control, "Days", which
// opens the day step: the definition's other open slots as chips, each on, tap
// to drop. That step used to open on EVERY booking with everything already
// ticked, which made the common case pay for the rare one (2026-09-15).
// A slot with no definition (built in the old per-day grid, or a one-off) is
// one day with no choice to make, exactly as before, and shows no Days control.
// The picker finds the definition itself from the slot, so no caller has to
// know the difference.

type Candidate = {
  id: string
  name: string
  roles: string[]
  /** Where they are already committed on any day THIS BOOKING COVERS, within
   *  this organization. */
  conflicts: BookingConflict[]
  /** They said no to THIS show. Kept on purpose (migration 0012) so the
   *  scheduler is not the last to know; booking them again is allowed. */
  declinedThisShow: boolean
}

/** Another open slot of the same definition, on another day. */
type SiblingSlot = { id: string; roomId: string; roomName: string; date: string }

function fmtDay(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * "Already scheduled on Northwind · pending on this show". Scheduled = a
 * confirmed booking that day; pending = pencilled or invited (Dan, 2026-09-07:
 * say which, so the scheduler knows whether the other show is real yet).
 */
export default function FillPositionPicker({
  positionId,
  positionRole,
  roomId,
  roomName,
  date,
  onFilled,
  onCancel,
}: {
  positionId: string
  positionRole: string
  roomId: string
  roomName: string
  date: string
  /** The rows that were written, so the grid can paint them before the page
   *  refresh lands. Verified writes, not a guess — see book(). */
  onFilled: (painted: PaintedBooking[]) => void
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
  // The conflict read is scoped to the days this booking COVERS, so it cannot
  // run until the day list is settled — otherwise it checks the clicked day,
  // then has to be thrown away and run again.
  const [daysReady, setDaysReady] = useState(false)

  useEffect(() => {
    let active = true
    setSiblings([])
    setDaysReady(false)
    setPlan(null)
    ;(async () => {
      const [{ data: me }, { data: room }] = await Promise.all([
        supabase.from('crew_call_positions').select('position_def_id').eq('id', positionId).maybeSingle(),
        supabase.from('rooms').select('show_id').eq('id', roomId).maybeSingle(),
      ])
      if (active) setShowId((room as any)?.show_id ?? null)
      const defId = (me as any)?.position_def_id
      // No definition means a one-day slot: no siblings, and the day list is
      // settled at exactly the day that was clicked.
      if (!defId || !active) { if (active) setDaysReady(true); return }
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
      setDaysReady(true)
    })()
    return () => { active = false }
  }, [positionId, roomId])

  // Every day this booking would cover — the clicked one plus the definition's
  // other open days. Sorted and joined so the effect below re-runs when the set
  // genuinely changes rather than on every new array identity.
  const bookingDates = [date, ...siblings.map(s => s.date)].sort().join(',')

  // The day step's chips: the clicked day (no id — it is not droppable) and the
  // definition's other open days, in DATE order rather than clicked-first.
  const dayChips: { id: string | null; date: string }[] =
    [{ id: null, date }, ...siblings.map(s => ({ id: s.id, date: s.date }))]
      .sort((a, b) => a.date.localeCompare(b.date))

  useEffect(() => {
    let active = true
    if (!daysReady) return
    ;(async () => {
      setLoading(true)
      // This room's show, for "this show" wording and for the declines below.
      const { data: roomRow } = await supabase.from('rooms').select('show_id').eq('id', roomId).maybeSingle()
      const thisShowId = ((roomRow as any)?.show_id ?? null) as string | null
      const [{ data: crew, error: crewErr }, { data: rates }, { data: booked }, { data: declined }] = await Promise.all([
        supabase.from('crew_members').select('id, full_name').order('full_name'),
        // Roles come from rate cards — the only place the app records what a
        // person does. Someone with no rate card simply has no roles listed and
        // shows up when the filter is off.
        //
        // Straight from `rate_cards`, NOT through crew_rate_cards_visible: that
        // view exists to gate `day_rate` and is therefore behind
        // can_view_pay_rates, which a scheduler has no business holding. Reading
        // it here meant every candidate showed as "No roles listed" and the role
        // filter matched nobody, for the one person the screen is built for
        // (found 2026-09-08). A ROLE IS NOT MONEY: `rate_cards.role` and
        // `crew_member_id` carry an ordinary org-scoped policy and a SELECT
        // grant; only `day_rate` is revoked, so asking for those two columns is
        // exactly as safe and works for everybody.
        supabase.from('rate_cards').select('crew_member_id, role'),
        // Who is already on something this date. Scoped by RLS to this
        // organization's shows; see the header note.
        // A declined booking is not a commitment — the position is free and so
        // is the person, so they are not a same-day conflict.
        liveBookings(supabase
          .from('timecards')
          .select(`
            crew_member_id, booking_status, room_id,
            rooms!inner ( name, work_days!inner ( date, shows!inner ( id, name ) ) )
          `))
          // EVERY DAY THIS BOOKING COVERS, not just the one clicked. The row
          // books the whole run in one press (2026-09-15), so checking only the
          // clicked day let somebody free on the Wednesday be booked straight
          // over a job they were already on for the rest of the week, with no
          // warning at all.
          .in('rooms.work_days.date', bookingDates.split(',')),
        // Who already said NO to this show (Dan, 2026-09-07: "so the scheduler
        // doesn't try to schedule the same person over again").
        thisShowId
          ? supabase.from('timecards').select('crew_member_id').eq('show_id', thisShowId).eq('booking_status', 'declined')
          : Promise.resolve({ data: [] as any[] }),
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
          {
            showId: show.id,
            showName: show.id === thisShowId ? 'this show' : show.name,
            roomName: room.name,
            // sameRoom stays about the CLICKED day: it is what refuses the row
            // outright ("In room"), and a clash on one of the other days is a
            // warning like any other.
            sameRoom: t.room_id === roomId && wd.date === date,
            status: t.booking_status ?? null,
            date: wd.date as string,
          },
        ])
      }
      const declinedIds = new Set(((declined ?? []) as any[]).map(t => t.crew_member_id).filter(Boolean))

      setCandidates((crew ?? []).map((c: any) => ({
        id: c.id,
        name: c.full_name,
        roles: rolesByCrew.get(c.id) ?? [],
        conflicts: conflictsByCrew.get(c.id) ?? [],
        declinedThisShow: declinedIds.has(c.id),
      })))
      setLoading(false)
    })()
    return () => { active = false }
  }, [bookingDates, roomId, daysReady])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return candidates.filter(c => {
      if (q && !c.name.toLowerCase().includes(q)) return false
      if (onlyRole && !c.roles.includes(positionRole)) return false
      return true
    })
  }, [candidates, onlyRole, search, positionRole])

  // THE ROW BOOKS THE WHOLE RUN. A position defined by kind of day runs on
  // several days and most of the time one person does all of them — which is
  // why the day step opened with every day ALREADY TICKED. Showing a screenful
  // of switches so somebody can agree with them cost a scroll and a second
  // click on every booking, twenty-odd times on a normal sheet (Dan,
  // 2026-09-15: "There is a lot of scrolling when scheduling"). So the row now
  // does the common thing, and the exception has its own door: `choose`.
  function fill(c: Candidate) {
    if (busy) return
    setError('')
    void book(c, siblings)
  }

  /** The exception — they are not doing the whole run. Opens the day step. */
  function choose(c: Candidate) {
    if (busy) return
    setError('')
    setPlan({ c, picked: new Set(siblings.map(s => s.id)) })
  }

  async function book(c: Candidate, extra: SiblingSlot[]) {
    setBusy(true)
    setError('')

    const targets = [
      { room_id: roomId, call_position_id: positionId, date },
      ...extra.map(s => ({ room_id: s.roomId, call_position_id: s.id, date: s.date })),
    ]

    // BOOKING SOMEBODY WHO DECLINED IS AN UPDATE, NOT AN INSERT.
    // A decline keeps its timecard on purpose (migration 0012 — it records that
    // we asked and they said no), and timecards_room_crew_uniq has NO status
    // predicate, so that row still occupies (room, person). Inserting a second
    // one is refused by the index, which made "Book anyway" on a decliner
    // impossible however many times it was pressed, with a clash message that
    // named nobody. Reviving their own row is what "they changed their mind"
    // actually means, and it keeps THE ONE RULE: nothing is deleted.
    const { data: mine, error: readErr } = await supabase
      .from('timecards').select('id, room_id, booking_status')
      .eq('crew_member_id', c.id).in('room_id', targets.map(t => t.room_id))
    if (readErr) { setBusy(false); setError(readErr.message); return }
    const existingByRoom = new Map((mine ?? []).map((r: any) => [r.room_id as string, r]))

    // Already in that room and NOT declined: a real double-booking. Say which day.
    const blocked = targets.find(t => {
      const r = existingByRoom.get(t.room_id)
      return r && r.booking_status !== 'declined'
    })
    if (blocked) {
      setBusy(false)
      setError(`${c.name} is already in this room on ${fmtDay(blocked.date)}. Untick that day and try again.`)
      return
    }

    // 'pencilled': penned in, not yet asked. day_rate is deliberately not sent —
    // a trigger sets the show-wide rate for (show, person, role), and the write
    // guard drops any rate supplied by someone without permission anyway.
    // One insert for every NEW day: all of them land or none do.
    const rows = targets
      .filter(t => !existingByRoom.has(t.room_id))
      .map(t => ({
        room_id: t.room_id,
        call_position_id: t.call_position_id,
        crew_member_id: c.id,
        crew_member_name: c.name,
        role: positionRole,
        booking_status: 'pencilled',
      }))
    const painted: PaintedBooking[] = []
    if (rows.length > 0) {
      const { data, error: e } = await supabase.from('timecards').insert(rows).select('id, call_position_id')
      if (e || !data?.length) {
        setBusy(false)
        // 23505 = a unique index: somebody else filled one of these positions
        // between the list loading and this click. Postgres names the clashing
        // key, so say which day rather than making them guess.
        setError(e?.code === '23505' ? clashMessage(e.details ?? '', c, extra) : (e?.message ?? 'That did not save.'))
        return
      }
      for (const r of data as any[]) {
        if (!r.call_position_id) continue
        painted.push({
          kind: 'book',
          slotId: r.call_position_id as string,
          booking: { timecardId: r.id as string, crewMemberId: c.id, crewMemberName: c.name, role: positionRole, status: 'pencilled' },
        })
      }
    }
    for (const t of targets) {
      const r = existingByRoom.get(t.room_id)
      if (!r) continue
      const { data, error: e } = await supabase.from('timecards')
        .update({ booking_status: 'pencilled', call_position_id: t.call_position_id, role: positionRole })
        .eq('id', r.id).select('id, call_position_id')
      if (e || !data?.length) {
        setBusy(false)
        setError(e?.message ?? 'That did not save.')
        return
      }
      const row = data[0] as any
      if (row.call_position_id) {
        painted.push({
          kind: 'book',
          slotId: row.call_position_id as string,
          booking: { timecardId: row.id as string, crewMemberId: c.id, crewMemberName: c.name, role: positionRole, status: 'pencilled' },
        })
      }
    }
    setBusy(false)

    // HAND THE GRID THE ANSWER FIRST. Everything above is already written and
    // verified; what used to follow was a staffing-event write and a full
    // server re-render of the whole screen before a single name appeared —
    // "a pretty long beat before it is populated" (Dan, 2026-09-15). The
    // tracker learned this for punches in September: paint at write
    // acknowledgement, reconcile in the background.
    onFilled(painted)

    // Best-effort by design (lib/staffingEvents.ts never throws), so it has no
    // business standing between the write and the screen. Not awaited.
    if (showId) {
      void logStaffingEvent(supabase, {
        showId,
        kind: 'booked',
        crewMemberId: c.id,
        crewMemberName: c.name,
        role: positionRole,
        days: compressDays([date, ...extra.map(s => s.date)]),
      })
    }
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
    // Capped, not full width: this opens inside a grid that can be 1200px
    // across, and a candidate list that wide put the name at one end of the
    // row and its button at the other (Dan, 2026-09-08: "the name and book are
    // so far apart").
    <div className="max-w-[620px] rounded-field border border-line p-3">
      {/* One line, not two. Where and when used to sit ABOVE the panel as a
          separate breadcrumb; between it, the header, the search box and the
          filter row there were ~160px of furniture before the first name. */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted">
          Fill · {positionRole}
          <span className="ml-2 font-normal normal-case tracking-normal">{roomName} · {fmtDay(date)}</span>
        </p>
        <button onClick={onCancel} className="shrink-0 text-xs text-muted hover:text-ink">Cancel</button>
      </div>

      {!plan && (
        <div className="mb-2 flex items-center gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search crew…"
            className="min-w-0 flex-1 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <label className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted">{positionRole}s only</span>
            <Toggle checked={onlyRole} onChange={setOnlyRole} />
          </label>
        </div>
      )}

      {plan ? (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-ink">
              {plan.c.name}&rsquo;s days
              <span className="ml-2 text-xs font-normal text-muted">tap a day to drop it</span>
            </p>
            {/* All / None, because the reason you opened this step is that the
                run is not the answer — and on a long show that is a dozen taps
                before you get to the two days you meant. */}
            <span className="flex items-center gap-2 text-xs">
              <button type="button" disabled={busy} className="text-muted underline-offset-2 hover:text-ink hover:underline"
                onClick={() => setPlan(p => p && { ...p, picked: new Set(siblings.map(x => x.id)) })}>All</button>
              <span className="text-line">|</span>
              <button type="button" disabled={busy} className="text-muted underline-offset-2 hover:text-ink hover:underline"
                onClick={() => setPlan(p => p && { ...p, picked: new Set<string>() })}>None</button>
            </span>
          </div>
          {/* CHIPS ON ONE WRAPPING LINE, not a full-width row per day. A row
              each is ~36px, so a five-day run was 180px of switches and a
              fortnight was most of a screen — inside a panel that already sits
              below the grid. Same information, one line. */}
          <div className="flex flex-wrap gap-1.5">
            {/* IN DATE ORDER, with the clicked day in its own place in the week.
                It used to lead the row whatever its date, so opening a position
                on the Wednesday read "Wed 23 · Mon 21 · Tue 22 · Thu 24" — a
                week you cannot read left to right, on the one control whose
                whole job is saying which days somebody is doing (Dan,
                2026-09-17). */}
            {dayChips.map(chip => {
              if (!chip.id) return (
                <span
                  key={chip.date}
                  title="The day you clicked — always included."
                  className="rounded-field border-2 border-ink bg-ink px-2.5 py-1.5 text-xs font-semibold text-bg"
                >
                  {fmtDay(chip.date)}
                </span>
              )
              const s = chip
              const on = plan.picked.has(s.id!)
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={on}
                  className={cn(
                    'rounded-field border-2 px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
                    on
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line bg-surface-2 text-muted line-through hover:border-ink hover:text-ink',
                  )}
                  onClick={() => setPlan(p => {
                    if (!p) return p
                    const picked = new Set(p.picked)
                    if (on) picked.delete(s.id!); else picked.add(s.id!)
                    return { ...p, picked }
                  })}
                >
                  {fmtDay(s.date)}
                </button>
              )
            })}
          </div>
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
            const warn = c.conflicts.length > 0 || c.declinedThisShow
            // THE WHOLE ROW IS THE BUTTON. The name is what you are reading, so
            // it is what you should be able to click; a button parked at the
            // right-hand end just adds distance to every booking.
            // Booked elsewhere is a WARNING, never a block: a load-out on one
            // show and a rehearsal on another in one day is normal.
            return (
              // Two controls, not one nested in the other: the row itself books
              // the run, and "Days" beside it opens the exception. A <button>
              // inside a <button> is invalid markup and does not reliably fire.
              <li key={c.id} className="flex items-stretch">
                <button
                  type="button"
                  disabled={busy || !!sameRoom}
                  title={sameRoom ? 'They are already in this room today.' : undefined}
                  onClick={() => fill(c)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{c.name}</span>
                    {c.conflicts.length > 0 && (
                      // Titled as well as shown: two jobs in one week is a long
                      // line in a 620px panel, and the part that truncates is
                      // the dates — which is the half worth reading.
                      <span
                        className="block truncate text-[11px] text-ot"
                        title={sameRoom ? undefined : describeConflicts(c.conflicts)}
                      >
                        {sameRoom ? 'Already in this room today' : describeConflicts(c.conflicts)}
                      </span>
                    )}
                    {c.conflicts.length === 0 && c.declinedThisShow && (
                      <span className="block truncate text-[11px] text-danger">Declined this show</span>
                    )}
                    {c.conflicts.length === 0 && !c.declinedThisShow && !c.roles.includes(positionRole) && (
                      <span className="block truncate text-[11px] text-muted">
                        {c.roles.length ? c.roles.join(', ') : 'No roles listed'}
                      </span>
                    )}
                  </span>
                  <span className={cn(
                    'shrink-0 text-[11px] font-semibold uppercase tracking-wide',
                    sameRoom ? 'text-muted' : warn ? 'text-ot' : 'text-accent',
                  )}>
                    {sameRoom ? 'In room'
                      : warn ? 'Book anyway'
                      : siblings.length > 0 ? `Book ${siblings.length + 1} days`
                      : 'Book'}
                  </span>
                </button>
                {siblings.length > 0 && !sameRoom && (
                  <button
                    type="button"
                    disabled={busy}
                    title={`${c.name.split(' ')[0]} is not doing all ${siblings.length + 1} days`}
                    onClick={() => choose(c)}
                    className="shrink-0 border-l border-line px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Days
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
