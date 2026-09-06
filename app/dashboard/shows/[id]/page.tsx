import { createClient } from '@/lib/supabase/server'
import OpenPositionRow from '@/components/OpenPositionRow'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import AddRoomModal from '@/components/AddRoomModal'
import StaffRoomModal from '@/components/StaffRoomModal'
import TimecardRow from '@/components/TimecardRow'
import BatchPunchBar from '@/components/BatchPunchBar'
import RoomActionsMenu from '@/components/RoomActionsMenu'
import CopyCrewButton from '@/components/CopyCrewButton'
import AddDayButton from '@/components/AddDayButton'
import UnlockShowButton from '@/components/UnlockShowButton'
import MobileRoomTracker from '@/components/MobileRoomTracker'
import { PUNCH_LABELS, isWrapped, visiblePunchTypes } from '@/lib/punches'
import { straightTimeHours, overtimeHours, doubleTimeHours } from '@/lib/payroll'
import { punchGridCols } from '@/lib/trackerLayout'
import { dayTypeBgClass, dayTypeLabel } from '@/lib/dayTypes'
import { fetchLiveTimecards, fetchShowRates, type TimecardRowMaybeRate } from '@/lib/timecardFields'
import Button from '@/components/ui/Button'
import { BAND, RULE_MAJOR } from '@/lib/panel'
import { cn } from '@/lib/cn'

export default async function ShowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ day?: string }>
}) {
  const { id } = await params
  const { day } = await searchParams
  const supabase = await createClient()
  // The caller and show/ruleset/workDays are independent of each other (none
  // depend on another's result) so fetch them in one round trip instead
  // of four sequential ones.
  const [
    user,
    { data: show },
    { data: ruleset },
    { data: workDays },
  ] = await Promise.all([
    getCurrentUser(),
    supabase.from('shows').select('*').eq('id', id).single(),
    supabase.from('payroll_rulesets').select('*').eq('show_id', id).single(),
    supabase.from('work_days').select('*').eq('show_id', id).order('day_number'),
  ])

  // The handoff-to-scheduler control and its position/scheduler queries used to
  // live here. Moved to Edit Show (2026-08-06): approving a call is an admin act
  // on the whole show, and it had no business sitting beside the punch controls.
  if (!user) redirect('/login')

  if (!show) notFound()
  // Belt and braces: RLS already hides every show from someone with no live
  // organization, so this should be unreachable. It exists so organizationId is
  // a plain string below rather than string | null.
  if (!user.organizationId) notFound()
  // Hoisted because TypeScript drops the narrowing above inside the .map()
  // callbacks further down — a local const keeps it.
  const organizationId = user.organizationId
  // The scheduling module. Gated on the FLAG, never on "are there any positions"
  // — a switched-off organization may still have positions sitting in the
  // database from before, and those must not reappear as open rows.
  const schedulingOn = canUseScheduling(user)

  const timezone = show.timezone_identifier || 'America/Chicago'
  // Finalized shows: the database refuses every punch and timecard write
  // (triggers on both tables). The UI used to present live controls anyway and
  // surface the rejection on the row afterwards, which reads as a bug rather
  // than a rule. Threaded into every control that writes those two tables.
  // Room rename/delete and Add Day are deliberately NOT disabled — the lock
  // does not cover rooms or work_days, so disabling them would misrepresent it.
  const locked = !!show.finalized_at

  // Pay-rate visibility/edit in Edit Crew is gated by permission only — the
  // day rate lives on the timecard regardless of whether the show displays $
  // in reports (that's what show_financials controls, separately).
  const canViewRates = user.can('can_view_pay_rates')
  const canEditRates = user.can('can_edit_pay_rates')

  if (!workDays || workDays.length === 0) {
    return (
      <div className="p-6 md:p-10">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
        <h1 className="text-2xl font-bold mt-4">{show.name}</h1>
        <p className="text-muted mt-2">No days generated for this show yet.</p>
      </div>
    )
  }

  // Fetch ALL rooms/timecards/punches across the WHOLE show (not just the
  // active day) so short-turnaround detection can look at a crew member's
  // previous day's end punch, which may be in a different room/day entirely.
  // Rooms and the org's rounding setting do not depend on each other, so they
  // go in one round trip. This page used to be nine awaits deep after its
  // opening Promise.all; every one of those is paid again on every
  // router.refresh(), i.e. after every punch.
  const [{ data: allShowRooms }, { data: organization }] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, name, work_day_id')
      .in('work_day_id', workDays.map(d => d.id))
      // Insertion order, matching iOS. Unordered, multiple rooms on a day came
      // back arbitrarily and could reshuffle between refreshes.
      .order('created_at'),
    supabase.from('organizations').select('timecard_rounding_minutes').eq('id', organizationId).single(),
  ])
  const roundingMinutes = organization?.timecard_rounding_minutes ?? 1

  const allRoomIds = (allShowRooms || []).map(r => r.id)

  // The tracker shows hours, never money — the only thing here that wants a rate
  // is RoomActionsMenu's rate editor. Rates come from the permission-checked
  // view, which yields nothing for a user who can't see them.
  // Declined bookings are excluded here, once, and every derived object below
  // inherits it — the roster, the day summary counts, Copy Crew's source, and
  // everything handed to MobileRoomTracker. Someone who said no is not crew.
  // Rates are gated on the permission, not just on the view returning nothing:
  // the view still executed a four-table join plus its helper calls for a user
  // who would be shown no rate anyway. Independent of the timecards read, so
  // the two share a round trip.
  const [allShowTimecards, rateById] = await Promise.all([
    fetchLiveTimecards<TimecardRowMaybeRate>(supabase, allRoomIds),
    canViewRates ? fetchShowRates(supabase, id) : Promise.resolve(new Map<string, number>()),
  ])

  // Compute "today" in the show's timezone, not UTC/device time — using
  // toISOString() here rolls to tomorrow's date in the evening for any
  // timezone behind UTC, which silently opens the wrong day.
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  const requestedIndex = day ? workDays.findIndex(d => d.day_number === parseInt(day)) : -1
  const todayIndex = workDays.findIndex(d => d.date === todayStr)
  const activeIndex = requestedIndex >= 0 ? requestedIndex : (todayIndex >= 0 ? todayIndex : 0)
  const activeDay = workDays[activeIndex]

  const roomsList = (allShowRooms || []).filter(r => r.work_day_id === activeDay.id)

  // PUNCHES: the active day's in full, earlier days' WRAPS only, later days'
  // not at all. Until 2026-09-06 every punch on the whole show was fetched
  // (select('*')) to render one day, on the grounds that short-turnaround
  // detection needs the previous day. It does — but isShortTurnaround
  // (lib/payroll.ts) reads exactly one thing from other cards: the `end` punch
  // of this crew member's earlier days. So that is all that is fetched for them.
  // punches is the table that grows with every shift worked; timecards are
  // bounded by days × crew and stay whole-show because copy-crew, the last-day
  // check and the duplicate-staffing guard read them across days.
  const earlierDayIds = new Set(workDays.slice(0, activeIndex).map(d => d.id))
  const dayRoomIdSet = new Set(roomsList.map(r => r.id))
  const earlierRoomIdSet = new Set((allShowRooms || []).filter(r => earlierDayIds.has(r.work_day_id)).map(r => r.id))
  const dayTimecardIds = (allShowTimecards || []).filter(t => dayRoomIdSet.has(t.room_id)).map(t => t.id)
  const earlierTimecardIds = (allShowTimecards || []).filter(t => earlierRoomIdSet.has(t.room_id)).map(t => t.id)

  const PUNCH_COLS = 'id, timecard_id, punch_type, punched_at, source'
  const [{ data: dayPunches }, { data: earlierWraps }] = await Promise.all([
    dayTimecardIds.length > 0
      ? supabase.from('punches').select(PUNCH_COLS).in('timecard_id', dayTimecardIds)
      : Promise.resolve({ data: [] as any[] }),
    earlierTimecardIds.length > 0
      ? supabase.from('punches').select(PUNCH_COLS).in('timecard_id', earlierTimecardIds).eq('punch_type', 'end')
      : Promise.resolve({ data: [] as any[] }),
  ])
  const allShowPunches = [...(dayPunches || []), ...(earlierWraps || [])]

  // Grouped once, not filtered per card — the old .filter-inside-.map was
  // O(timecards × punches) and ran twice.
  const punchesByTimecard = new Map<string, any[]>()
  for (const p of allShowPunches) {
    const list = punchesByTimecard.get(p.timecard_id) ?? []
    list.push(p)
    punchesByTimecard.set(p.timecard_id, list)
  }

  const allTimecardsWithPunches = (allShowTimecards || []).map(tc => ({
    id: tc.id,
    crew_member_id: tc.crew_member_id,
    // 0 when the caller can't see rates: only the money functions read this,
    // and the tracker calls none of them.
    day_rate: rateById.get(tc.id) ?? 0,
    is_travel_day: tc.is_travel_day,
    travel_in_day: tc.travel_in_day,
    travel_out_day: tc.travel_out_day,
    pay_as_half_day: tc.pay_as_half_day,
    punches: punchesByTimecard.get(tc.id) ?? [],
  }))

  // Stable sort so toggling travel / refetching never reorders the cards:
  // by first name, then full name, then id as a final tiebreaker.
  const firstName = (n: string) => (n || '').trim().split(/\s+/)[0].toLowerCase()
  const byFirstName = (a: any, b: any) =>
    firstName(a.crew_member_name).localeCompare(firstName(b.crew_member_name)) ||
    (a.crew_member_name || '').localeCompare(b.crew_member_name || '') ||
    a.id.localeCompare(b.id)

  // Unfilled positions on this day's rooms. A gap in the crew belongs on the
  // screen that shows the crew — not behind a menu, which is where filling one
  // used to live.
  const dayRoomIds = roomsList.map(r => r.id)
  const { data: openPositionRows } = schedulingOn && dayRoomIds.length > 0
    ? await supabase
        .from('crew_call_positions')
        .select('id, room_id, role, sort_order, timecards(booking_status)')
        .in('room_id', dayRoomIds)
        .order('sort_order')
    : { data: [] }

  const openByRoom: Record<string, { id: string; role: string }[]> = {}
  for (const row of (openPositionRows ?? []) as any[]) {
    // A declined person does not hold their position, so it is open again —
    // the same rule the database enforces with its partial unique index.
    const live = (row.timecards ?? []).some((t: any) => t.booking_status !== 'declined')
    if (live) continue
    openByRoom[row.room_id] = [...(openByRoom[row.room_id] ?? []), { id: row.id, role: row.role }]
  }

  const roomTimecards: Record<string, any[]> = {}
  for (const room of roomsList) {
    roomTimecards[room.id] = (allShowTimecards || [])
      .filter(t => t.room_id === room.id)
      .map(tc => ({
        ...tc,
        punches: punchesByTimecard.get(tc.id) ?? [],
      }))
      .sort(byFirstName)
  }

  const remainingWorkDayIds = workDays.slice(activeIndex + 1).map(d => d.id)

  const remainingRoomsByName: Record<string, string[]> = {}
  for (const room of roomsList) {
    remainingRoomsByName[room.id] = (allShowRooms || [])
      .filter(fr => fr.name === room.name && remainingWorkDayIds.includes(fr.work_day_id))
      .map(fr => fr.id)
  }

  const prevDay = workDays[activeIndex - 1]
  const nextDay = workDays[activeIndex + 1]

  // "Copy Crew from Day N" — for each room today, the same-named room on the
  // previous day and how many crew it holds. Offered only when this room is
  // empty and that one isn't, matching iOS's empty-roster shortcut.
  // On the last day, the "next" chevron becomes Add Day — iOS puts it right on
  // the day switcher rather than only inside Edit Show.
  const lastDay = workDays[workDays.length - 1]
  const lastDayRoomIds = (allShowRooms || []).filter(r => r.work_day_id === lastDay.id).map(r => r.id)
  const lastDayHasCrew = (allShowTimecards || []).some(t => lastDayRoomIds.includes(t.room_id))
  const addDayControl = (
    <AddDayButton
      showId={id}
      hasCrew={lastDayHasCrew}
      variant="circle"
    />
  )

  const copySourceByRoom: Record<string, { roomId: string; count: number; dayNumber: number } | null> = {}
  for (const room of roomsList) {
    const src = prevDay
      ? (allShowRooms || []).find(r => r.name === room.name && r.work_day_id === prevDay.id)
      : undefined
    const count = src ? (allShowTimecards || []).filter(t => t.room_id === src.id).length : 0
    copySourceByRoom[room.id] = src && count > 0
      ? { roomId: src.id, count, dayNumber: prevDay.day_number }
      : null
  }

  const dateLabel = new Date(activeDay.date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })

  // Day summary — sum the day's worked hours the same way each TimecardRow
  // displays them: only wrapped cards contribute, using the raw ST/OT/DT
  // worked-hours convention (not the ceiling-rounded "paid" totals).
  const dayTimecards = roomsList.flatMap(r => roomTimecards[r.id] || []).sort(byFirstName)

  // One column set for the whole day, shared by every room. Computed here
  // rather than per room so two rooms side by side are never different widths.
  const dayPunchTypes = visiblePunchTypes(dayTimecards.map(tc => tc.punches))

  // Who is already staffed where today — powers the duplicate-staffing
  // safeguard in StaffRoomModal (block same room, confirm cross-room).
  const roomNameById: Record<string, string> = Object.fromEntries(roomsList.map(r => [r.id, r.name]))
  const dayAssignments = (allShowTimecards || [])
    .filter(t => t.crew_member_id && roomNameById[t.room_id])
    .map(t => ({ crewMemberId: t.crew_member_id as string, roomId: t.room_id as string, roomName: roomNameById[t.room_id] }))
  // ST/OT/DT per row, computed ONCE, here. Each of these three calls runs
  // isShortTurnaround, a scan of every card on the show — until 2026-09-06 the
  // server did it for the summary and then every TimecardRow did it again in
  // the browser, in both the desktop and the mobile tree: 2 × crew × 3 × cards
  // scans per render, on hydration and after every punch. The rows now receive
  // the numbers; the whole-show card list never leaves the server.
  const ZERO_HOURS = { st: 0, ot: 0, dt: 0 }
  const hoursById: Record<string, { st: number; ot: number; dt: number }> = {}
  let sumST = 0, sumOT = 0, sumDT = 0
  if (ruleset) {
    for (const tc of dayTimecards) {
      if (!isWrapped(tc.punches)) continue
      const h = {
        st: straightTimeHours(tc, allTimecardsWithPunches, ruleset, roundingMinutes),
        ot: overtimeHours(tc, allTimecardsWithPunches, ruleset, roundingMinutes),
        dt: doubleTimeHours(tc, allTimecardsWithPunches, ruleset, roundingMinutes),
      }
      hoursById[tc.id] = h
      sumST += h.st; sumOT += h.ot; sumDT += h.dt
    }
  }
  const summary = {
    crew: dayTimecards.length,
    rooms: roomsList.length,
    st: sumST,
    otdt: sumOT + sumDT,
  }

  const showMeta = [show.venue, show.city_state, show.client_company].filter(Boolean).join(' · ')

  return (
    <div className="p-6 md:p-10 lg:mx-auto lg:max-w-[1400px]">
      {/* Desktop header strip. This was a 240px left rail holding the show
          name, day nav, four stat tiles and four stacked buttons — roughly a
          quarter of the width, permanently, to hold things you read rather than
          work in. Laid across the top instead, the punch grid gets the whole
          page. The mobile header lives inside MobileRoomTracker so its add-crew
          icon can target the currently selected room. */}
      <header className="hidden lg:block">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>

        <div className="mt-2 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold uppercase tracking-wide">{show.name}</h1>
            {showMeta && <p className="mt-1 truncate text-sm text-muted">{showMeta}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={prevDay ? `?day=${prevDay.day_number}` : '#'}
              aria-label="Previous day"
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-field border border-line bg-surface-2',
                !prevDay ? 'pointer-events-none opacity-30' : 'hover:border-accent hover:text-accent',
              )}
            >
              ‹
            </Link>
            <div className="min-w-[168px] text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Day {activeDay.day_number} of {workDays.length}
              </p>
              <p className="text-base font-bold tabular-nums text-ink">{dateLabel}</p>
              {/* Read-only. The picker moved to Edit Show — on the tracker a
                  dropdown under the date read as a question the operator had to
                  answer before punching anybody in. Nothing shows when no type
                  is set, rather than a "Set day type…" prompt. */}
              {dayTypeLabel(activeDay.day_type) && (
                <p className="mt-1 flex items-center justify-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                  <span className={cn('h-2 w-2 shrink-0', dayTypeBgClass(activeDay.day_type) ?? 'bg-line')} />
                  {dayTypeLabel(activeDay.day_type)}
                </p>
              )}
            </div>
            {nextDay ? (
              <Link
                href={`?day=${nextDay.day_number}`}
                aria-label="Next day"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-field border border-line bg-surface-2 hover:border-accent hover:text-accent"
              >
                ›
              </Link>
            ) : (
              addDayControl
            )}
          </div>
        </div>

        {show.finalized_at && (
          // Open Paper: a warning is a rule in the margin, not a box — the
          // danger-colored 3px left rule is the strongest non-band edge here.
          <div className="mt-3 border-l-[3px] border-danger py-1 pl-3">
            <p className="text-sm font-semibold text-ink">Times locked</p>
            <p className="mt-1 text-xs text-muted">
              The final report was sent{' '}
              {new Date(show.finalized_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric', timeZone: timezone,
              })}
              . Punches and staffing are rejected by the database until the show is unlocked.
            </p>
            {user.can('can_manage_users') && (
              <div className="mt-2"><UnlockShowButton showId={id} /></div>
            )}
          </div>
        )}

        {/* Stats inline, not as four tiles in a 2x2 grid. Same four numbers,
            one line, and the actions sit on the same rule rather than stacking
            underneath them. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-line py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Crew</p>
            <p className="text-lg font-bold tabular-nums text-ink">{summary.crew}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Rooms</p>
            <p className="text-lg font-bold tabular-nums text-ink">{summary.rooms}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">ST hrs</p>
            <p className="text-lg font-bold tabular-nums text-ink">{summary.st.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">OT / DT</p>
            <p className="text-lg font-bold tabular-nums text-ink">{summary.otdt.toFixed(2)}</p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <AddRoomModal
              showId={id}
              currentWorkDayId={activeDay.id}
              remainingWorkDayIds={remainingWorkDayIds}
            />
            <Link href={`/dashboard/shows/${id}/edit`}>
              <Button variant="ghost" size="sm">Edit Show</Button>
            </Link>
            <Link href={`/dashboard/shows/${id}/reports`}>
              <Button variant="ghost" size="sm">View Report</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* One room per row, at every width.
          Rooms used to sit two-up on a 2xl screen, which meant the punch table
          only had half the width to work with — tight at six columns and
          unreadable at eight. Making it conditional on the column count fixed
          the width but introduced something worse: the whole page reflowed the
          moment someone punched an M2 In. A fixed single column is calmer, gives
          the table the full width whatever it's showing, and means nothing about
          the layout depends on punch state.
          The desktop/mobile distinction still holds — this is the ruled grid,
          mobile renders labelled cards. */}
      <div className="hidden lg:grid min-w-0 grid-cols-1 gap-9">
        {/* Punch everyone on the day at once, across every room — the same thing
            mobile offers in its "All Rooms" view. Only worth showing with more
            than one room: with a single room it would duplicate that room's own
            bar exactly. Matters more now rooms stack one per row, since reaching
            each room's bar means scrolling past the one above it. */}
        {roomsList.length > 1 && dayTimecards.length > 0 && (
          // No rule under it now the rooms below are boxed — a bare hairline
          // floating above a bordered surface reads as a leftover. This is a
          // page-level control sitting above the content, the same shape as the
          // search field above Directory's table.
          <div className="pb-1">
            <BatchPunchBar
              roundingMinutes={roundingMinutes}
              authorId={user.id}
              locked={locked}
              timecards={dayTimecards}
              dayDate={activeDay.date}
              timezone={timezone}
              label={`All Rooms · ${dayTimecards.length} crew`}
              gridCols={punchGridCols(dayPunchTypes.length)}
              columns={dayPunchTypes}
            />
          </div>
        )}

        {roomsList.map(room => {
          const crew = roomTimecards[room.id] || []
          return (
            // Open Paper: the room's boundary is a masthead BAND, not a box —
            // a room is a real unit (its own name, ⋮ menu and batch bar), and
            // punching someone into the wrong room is a live error, so it gets
            // the strongest boundary the system has. The unit closes with a 3px
            // ink rule; rooms are separated by whitespace and the next band.
            // No `overflow-hidden` anywhere on this block: RoomActionsMenu
            // opens a dropdown out of it, and clipping would cut the menu off.
            <section key={room.id} className="min-w-0">
              <div className={cn(BAND, 'flex items-center justify-between px-4 py-2')}>
                <h2 className="font-display text-lg font-bold uppercase tracking-wide">{room.name}</h2>
                <RoomActionsMenu onBand schedulingEnabled={schedulingOn} locked={locked} roomId={room.id} roomName={room.name} crewCount={crew.length} crew={crew.map(tc => ({ id: tc.id, crewMemberId: tc.crew_member_id, name: tc.crew_member_name, role: tc.role, dayRate: rateById.get(tc.id) ?? 0 }))} canViewRates={canViewRates} canEditRates={canEditRates} />
              </div>

              {crew.length > 0 && (
                <BatchPunchBar
                  roundingMinutes={roundingMinutes}
                  authorId={user.id}
                  timecards={crew}
                  dayDate={activeDay.date}
                  timezone={timezone}
                  locked={locked}
                  label={null}
                  gridCols={punchGridCols(dayPunchTypes.length)}
                  columns={dayPunchTypes}
                />
              )}

              {/* Column headers — only meaningful once there's a ruled table
                  to head; hidden on mobile where TimecardRow renders labeled
                  cards instead. Must stay in sync with TimecardRow's grid. */}
              {crew.length > 0 && (
                <div className={cn('hidden lg:grid gap-3 border-b border-line px-4 pt-3 pb-1', punchGridCols(dayPunchTypes.length))}>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Crew</div>
                  {dayPunchTypes.map(type => (
                    <div key={type} className="text-[10px] font-bold uppercase tracking-wide text-muted text-center">
                      {PUNCH_LABELS[type]}
                    </div>
                  ))}
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted text-center">Travel</div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted text-right">Total</div>
                  <div />
                </div>
              )}

              {/* The unit closes with a 3px ink rule — the Open Paper edge that
                  replaced the panel border. */}
              <div className={RULE_MAJOR}>
                {crew.length === 0 && (
                  <>
                    <p className="text-sm text-muted p-4 pb-2">No crew staffed yet.</p>
                    {copySourceByRoom[room.id] && (
                      <CopyCrewButton
                        locked={locked}
                        targetRoomId={room.id}
                        sourceRoomId={copySourceByRoom[room.id]!.roomId}
                        sourceDayNumber={copySourceByRoom[room.id]!.dayNumber}
                        count={copySourceByRoom[room.id]!.count}
                      />
                    )}
                  </>
                )}
                {crew.map(tc => (
                  <TimecardRow
                    authorId={user.id}
                    locked={locked}
                    key={tc.id}
                    timecard={tc}
                    punches={tc.punches}
                    timezone={timezone}
                    ruleset={ruleset}
                    hours={hoursById[tc.id] ?? ZERO_HOURS}
                    dayDate={activeDay.date}
                    use24Hour={user.use24Hour}
                    roundingMinutes={roundingMinutes}
                    visibleTypes={dayPunchTypes}
                  />
                ))}

                {schedulingOn && (openByRoom[room.id] ?? []).map(pos => (
                  <OpenPositionRow
                    key={pos.id}
                    positionId={pos.id}
                    role={pos.role}
                    roomId={room.id}
                    date={activeDay.date}
                    gridCols={punchGridCols(dayPunchTypes.length)}
                    punchCount={dayPunchTypes.length}
                    locked={locked}
                  />
                ))}
              </div>

              <div className="pt-3">
                <StaffRoomModal
                  locked={locked}
                  organizationId={organizationId}
                  roomId={room.id}
                  roomName={room.name}
                  currentWorkDayId={activeDay.id}
                  remainingRoomIdsSameName={remainingRoomsByName[room.id] || []}
                  dayAssignments={dayAssignments}
                  canEditRates={canEditRates}
                />
              </div>
            </section>
          )
        })}
      </div>

      <MobileRoomTracker
        authorId={user.id}
        locked={locked}
        className="lg:hidden min-w-0"
        showId={id}
        showName={show.name}
        showMeta={showMeta || undefined}
        editHref={`/dashboard/shows/${id}/edit`}
        reportHref={`/dashboard/shows/${id}/reports`}
        dayNumber={activeDay.day_number}
        totalDays={workDays.length}
        workDayId={activeDay.id}
        dayType={activeDay.day_type ?? null}
        dateLabel={dateLabel}
        prevDayNumber={prevDay?.day_number ?? null}
        nextDayNumber={nextDay?.day_number ?? null}
        rooms={roomsList.map(r => ({ id: r.id, name: r.name }))}
        roomCrew={roomTimecards}
        dayCrew={dayTimecards}
        timezone={timezone}
        ruleset={ruleset}
        hoursById={hoursById}
        dayDate={activeDay.date}
        use24Hour={user.use24Hour}
        roundingMinutes={roundingMinutes}
        organizationId={organizationId}
        currentWorkDayId={activeDay.id}
        remainingWorkDayIds={remainingWorkDayIds}
        remainingRoomsByName={remainingRoomsByName}
        dayAssignments={dayAssignments}
        copySourceByRoom={copySourceByRoom}
        addDayControl={addDayControl}
        canViewRates={canViewRates}
        canEditRates={canEditRates}
        schedulingEnabled={schedulingOn}
        // Plain object, not the Map: this crosses into a Client Component.
        ratesByTimecardId={Object.fromEntries(rateById)}
      />
    </div>
  )
}
