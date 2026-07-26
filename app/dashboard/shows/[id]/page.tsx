import { createClient } from '@/lib/supabase/server'
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
import { PUNCH_ORDER, PUNCH_LABELS, isWrapped } from '@/lib/punches'
import { straightTimeHours, overtimeHours, doubleTimeHours } from '@/lib/payroll'
import { PUNCH_GRID_COLS } from '@/lib/trackerLayout'
import Button from '@/components/ui/Button'
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // profile/show/ruleset/workDays are independent of each other (none
  // depend on another's result) so fetch them in one round trip instead
  // of four sequential ones.
  const [
    { data: profile },
    { data: show },
    { data: ruleset },
    { data: workDays },
  ] = await Promise.all([
    supabase.from('profiles').select('organization_id, use_24_hour_time, can_view_pay_rates, can_edit_pay_rates, can_manage_users').eq('id', user.id).single(),
    supabase.from('shows').select('*').eq('id', id).single(),
    supabase.from('payroll_rulesets').select('*').eq('show_id', id).single(),
    supabase.from('work_days').select('*').eq('show_id', id).order('day_number'),
  ])

  if (!show) notFound()

  const timezone = show.timezone_identifier || 'America/Chicago'

  const { data: organization } = profile?.organization_id
    ? await supabase.from('organizations').select('timecard_rounding_minutes').eq('id', profile.organization_id).single()
    : { data: null }
  const roundingMinutes = organization?.timecard_rounding_minutes ?? 1

  // Pay-rate visibility/edit in Edit Crew is gated by permission only — the
  // day rate lives on the timecard regardless of whether the show displays $
  // in reports (that's what show_financials controls, separately).
  const canViewRates = profile?.can_view_pay_rates ?? false
  const canEditRates = profile?.can_edit_pay_rates ?? false

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
  const { data: allShowRooms } = await supabase
    .from('rooms')
    .select('id, name, work_day_id')
    .in('work_day_id', workDays.map(d => d.id))
    // Insertion order, matching iOS. Unordered, multiple rooms on a day came
    // back arbitrarily and could reshuffle between refreshes.
    .order('created_at')

  const allRoomIds = (allShowRooms || []).map(r => r.id)

  const { data: allShowTimecards } = allRoomIds.length > 0
    ? await supabase.from('timecards').select('*').in('room_id', allRoomIds)
    : { data: [] }

  const allTimecardIds = (allShowTimecards || []).map(t => t.id)

  const { data: allShowPunches } = allTimecardIds.length > 0
    ? await supabase.from('punches').select('*').in('timecard_id', allTimecardIds)
    : { data: [] }

  const allTimecardsWithPunches = (allShowTimecards || []).map(tc => ({
    id: tc.id,
    crew_member_id: tc.crew_member_id,
    day_rate: tc.day_rate,
    is_travel_day: tc.is_travel_day,
    travel_in_day: tc.travel_in_day,
    travel_out_day: tc.travel_out_day,
    pay_as_half_day: tc.pay_as_half_day,
    punches: (allShowPunches || []).filter(p => p.timecard_id === tc.id),
  }))

  // Compute "today" in the show's timezone, not UTC/device time — using
  // toISOString() here rolls to tomorrow's date in the evening for any
  // timezone behind UTC, which silently opens the wrong day.
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  const requestedIndex = day ? workDays.findIndex(d => d.day_number === parseInt(day)) : -1
  const todayIndex = workDays.findIndex(d => d.date === todayStr)
  const activeIndex = requestedIndex >= 0 ? requestedIndex : (todayIndex >= 0 ? todayIndex : 0)
  const activeDay = workDays[activeIndex]

  const roomsList = (allShowRooms || []).filter(r => r.work_day_id === activeDay.id)

  // Stable sort so toggling travel / refetching never reorders the cards:
  // by first name, then full name, then id as a final tiebreaker.
  const firstName = (n: string) => (n || '').trim().split(/\s+/)[0].toLowerCase()
  const byFirstName = (a: any, b: any) =>
    firstName(a.crew_member_name).localeCompare(firstName(b.crew_member_name)) ||
    (a.crew_member_name || '').localeCompare(b.crew_member_name || '') ||
    a.id.localeCompare(b.id)

  const roomTimecards: Record<string, any[]> = {}
  for (const room of roomsList) {
    roomTimecards[room.id] = (allShowTimecards || [])
      .filter(t => t.room_id === room.id)
      .map(tc => ({
        ...tc,
        punches: (allShowPunches || []).filter(p => p.timecard_id === tc.id),
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
      endDate={show.end_date}
      workDays={workDays}
      rooms={allShowRooms || []}
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

  // Who is already staffed where today — powers the duplicate-staffing
  // safeguard in StaffRoomModal (block same room, confirm cross-room).
  const roomNameById: Record<string, string> = Object.fromEntries(roomsList.map(r => [r.id, r.name]))
  const dayAssignments = (allShowTimecards || [])
    .filter(t => t.crew_member_id && roomNameById[t.room_id])
    .map(t => ({ crewMemberId: t.crew_member_id as string, roomId: t.room_id as string, roomName: roomNameById[t.room_id] }))
  let sumST = 0, sumOT = 0, sumDT = 0
  if (ruleset) {
    for (const tc of dayTimecards) {
      if (!isWrapped(tc.punches)) continue
      sumST += straightTimeHours(tc, allTimecardsWithPunches, ruleset, roundingMinutes)
      sumOT += overtimeHours(tc, allTimecardsWithPunches, ruleset, roundingMinutes)
      sumDT += doubleTimeHours(tc, allTimecardsWithPunches, ruleset, roundingMinutes)
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
    <div className="p-6 md:p-10 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8 lg:max-w-[1400px] lg:mx-auto">
      {/* Left rail (desktop only): show info, day nav, day summary, actions.
          The mobile header lives inside MobileRoomTracker so its add-crew
          icon can target the currently selected room. */}
      <aside className="hidden lg:block space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div>
          <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
          <h1 className="text-2xl font-extrabold tracking-tight mt-2">{show.name}</h1>
          {showMeta && <p className="text-sm text-muted mt-1">{showMeta}</p>}
        </div>

        {show.finalized_at && (
          <div className="rounded-card border border-line bg-surface-2 p-3">
            <p className="text-sm font-semibold text-ink">Times locked</p>
            <p className="text-xs text-muted mt-1">
              The final report was sent{' '}
              {new Date(show.finalized_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric', timeZone: timezone,
              })}
              . Punches and staffing are rejected by the database until the show is unlocked.
            </p>
            {profile?.can_manage_users && (
              <div className="mt-2"><UnlockShowButton showId={id} /></div>
            )}
          </div>
        )}

        <div className="rounded-card border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <Link
              href={prevDay ? `?day=${prevDay.day_number}` : '#'}
              aria-label="Previous day"
              className={cn(
                'rounded-full bg-surface-2 border border-line h-9 w-9 flex items-center justify-center shrink-0',
                !prevDay ? 'pointer-events-none opacity-30' : 'hover:border-accent hover:text-accent',
              )}
            >
              ‹
            </Link>
            <div className="text-center">
              <p className="text-xs uppercase tracking-wide text-muted font-semibold">Day {activeDay.day_number} of {workDays.length}</p>
              <p className="text-base font-bold text-ink tabular-nums">{dateLabel}</p>
            </div>
            {nextDay ? (
              <Link
                href={`?day=${nextDay.day_number}`}
                aria-label="Next day"
                className="rounded-full bg-surface-2 border border-line h-9 w-9 flex items-center justify-center shrink-0 hover:border-accent hover:text-accent"
              >
                ›
              </Link>
            ) : (
              addDayControl
            )}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-2">Day summary</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-field bg-surface-2 px-3 py-2">
              <p className="text-xs text-muted">Crew</p>
              <p className="text-xl font-bold text-ink tabular-nums">{summary.crew}</p>
            </div>
            <div className="rounded-field bg-surface-2 px-3 py-2">
              <p className="text-xs text-muted">Rooms</p>
              <p className="text-xl font-bold text-ink tabular-nums">{summary.rooms}</p>
            </div>
            <div className="rounded-field bg-surface-2 px-3 py-2">
              <p className="text-xs text-muted">ST hrs</p>
              <p className="text-xl font-bold text-ink tabular-nums">{summary.st.toFixed(2)}</p>
            </div>
            <div className="rounded-field bg-surface-2 px-3 py-2">
              <p className="text-xs text-muted">OT / DT</p>
              <p className="text-xl font-bold text-ink tabular-nums">{summary.otdt.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2">
          <AddRoomModal
            showId={id}
            currentWorkDayId={activeDay.id}
            remainingWorkDayIds={remainingWorkDayIds}
          />
          <Link href={`/dashboard/shows/${id}/edit`} className="w-full">
            <Button variant="ghost" size="sm" className="w-full">Edit Show</Button>
          </Link>
          <Link href={`/dashboard/shows/${id}/reports`} className="w-full">
            <Button variant="ghost" size="sm" className="w-full">View Report</Button>
          </Link>
        </div>
      </aside>

      <div className="hidden lg:grid min-w-0 grid-cols-1 2xl:grid-cols-2 gap-4">
        {roomsList.map(room => {
          const crew = roomTimecards[room.id] || []
          return (
            <div key={room.id} className="rounded-card border border-line bg-surface">
              <div className="flex items-center justify-between p-4 border-b border-line">
                <h2 className="text-lg font-bold text-ink">{room.name}</h2>
                <RoomActionsMenu roomId={room.id} roomName={room.name} crewCount={crew.length} crew={crew.map(tc => ({ id: tc.id, crewMemberId: tc.crew_member_id, name: tc.crew_member_name, role: tc.role, dayRate: tc.day_rate }))} canViewRates={canViewRates} canEditRates={canEditRates} />
              </div>

              {crew.length > 0 && <BatchPunchBar timecards={crew} dayDate={activeDay.date} timezone={timezone} />}

              {/* Column headers — only meaningful once there's a ruled table
                  to head; hidden on mobile where TimecardRow renders labeled
                  cards instead. Must stay in sync with TimecardRow's grid. */}
              {crew.length > 0 && (
                <div className={cn('hidden lg:grid gap-3 px-4 pt-3 pb-1', PUNCH_GRID_COLS)}>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Crew</div>
                  {PUNCH_ORDER.map(type => (
                    <div key={type} className="text-[10px] font-bold uppercase tracking-wide text-muted text-center">
                      {PUNCH_LABELS[type]}
                    </div>
                  ))}
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted text-right">Total</div>
                </div>
              )}

              <div>
                {crew.length === 0 && (
                  <>
                    <p className="text-sm text-muted p-4 pb-2">No crew staffed yet.</p>
                    {copySourceByRoom[room.id] && (
                      <CopyCrewButton
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
                    key={tc.id}
                    timecard={tc}
                    punches={tc.punches}
                    timezone={timezone}
                    ruleset={ruleset}
                    allTimecards={allTimecardsWithPunches}
                    dayDate={activeDay.date}
                    use24Hour={profile?.use_24_hour_time || false}
                    roundingMinutes={roundingMinutes}
                  />
                ))}
              </div>

              <div className="p-4 pt-3">
                <StaffRoomModal
                  organizationId={profile?.organization_id}
                  roomId={room.id}
                  roomName={room.name}
                  currentWorkDayId={activeDay.id}
                  remainingRoomIdsSameName={remainingRoomsByName[room.id] || []}
                  dayAssignments={dayAssignments}
                />
              </div>
            </div>
          )
        })}
      </div>

      <MobileRoomTracker
        className="lg:hidden min-w-0"
        showId={id}
        showName={show.name}
        showMeta={showMeta || undefined}
        editHref={`/dashboard/shows/${id}/edit`}
        reportHref={`/dashboard/shows/${id}/reports`}
        dayNumber={activeDay.day_number}
        totalDays={workDays.length}
        dateLabel={dateLabel}
        prevDayNumber={prevDay?.day_number ?? null}
        nextDayNumber={nextDay?.day_number ?? null}
        rooms={roomsList.map(r => ({ id: r.id, name: r.name }))}
        roomCrew={roomTimecards}
        dayCrew={dayTimecards}
        timezone={timezone}
        ruleset={ruleset}
        allTimecards={allTimecardsWithPunches}
        dayDate={activeDay.date}
        use24Hour={profile?.use_24_hour_time || false}
        roundingMinutes={roundingMinutes}
        organizationId={profile?.organization_id}
        currentWorkDayId={activeDay.id}
        remainingWorkDayIds={remainingWorkDayIds}
        remainingRoomsByName={remainingRoomsByName}
        dayAssignments={dayAssignments}
        copySourceByRoom={copySourceByRoom}
        addDayControl={addDayControl}
        canViewRates={canViewRates}
        canEditRates={canEditRates}
      />
    </div>
  )
}
