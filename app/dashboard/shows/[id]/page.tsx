import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import AddRoomModal from '@/components/AddRoomModal'
import StaffRoomModal from '@/components/StaffRoomModal'
import TimecardRow from '@/components/TimecardRow'
import BatchPunchBar from '@/components/BatchPunchBar'
import RoomActionsMenu from '@/components/RoomActionsMenu'
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
    supabase.from('profiles').select('organization_id, use_24_hour_time').eq('id', user.id).single(),
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

  const roomTimecards: Record<string, any[]> = {}
  for (const room of roomsList) {
    roomTimecards[room.id] = (allShowTimecards || [])
      .filter(t => t.room_id === room.id)
      .map(tc => ({
        ...tc,
        punches: (allShowPunches || []).filter(p => p.timecard_id === tc.id),
      }))
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

  const dateLabel = new Date(activeDay.date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })

  // Day summary — sum the day's worked hours the same way each TimecardRow
  // displays them: only wrapped cards contribute, using the raw ST/OT/DT
  // worked-hours convention (not the ceiling-rounded "paid" totals).
  const dayTimecards = roomsList.flatMap(r => roomTimecards[r.id] || [])
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

  const showMeta = [show.venue, show.client_company].filter(Boolean).join(' · ')

  return (
    <div className="p-6 md:p-10 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8 lg:max-w-[1400px] lg:mx-auto">
      {/* Mobile compact header: show info, small action icons, day nav.
          Hidden on desktop, where the rail below takes over. */}
      <div className="lg:hidden mb-6">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
        <div className="flex items-start justify-between gap-3 mt-2">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight truncate">{show.name}</h1>
            {showMeta && <p className="text-sm text-muted truncate">{showMeta}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href={`/dashboard/shows/${id}/edit`}>
              <Button variant="ghost" size="sm" aria-label="Edit Show">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </Button>
            </Link>
            <Link href={`/dashboard/shows/${id}/reports`}>
              <Button variant="ghost" size="sm" aria-label="View Report">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                  <path d="M14 3v6h6" />
                  <path d="M9 14h6M9 17h6" />
                </svg>
              </Button>
            </Link>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 mt-5">
          <Link
            href={prevDay ? `?day=${prevDay.day_number}` : '#'}
            aria-label="Previous day"
            className={cn(
              'rounded-full h-9 w-9 flex items-center justify-center shrink-0',
              !prevDay ? 'pointer-events-none bg-surface-2 text-muted opacity-30' : 'bg-accent text-accent-ink',
            )}
          >
            ‹
          </Link>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-muted font-semibold">Day {activeDay.day_number} of {workDays.length}</p>
            <p className="text-lg font-bold text-ink tabular-nums">{dateLabel}</p>
          </div>
          <Link
            href={nextDay ? `?day=${nextDay.day_number}` : '#'}
            aria-label="Next day"
            className={cn(
              'rounded-full h-9 w-9 flex items-center justify-center shrink-0',
              !nextDay ? 'pointer-events-none bg-surface-2 text-muted opacity-30' : 'bg-accent text-accent-ink',
            )}
          >
            ›
          </Link>
        </div>
      </div>

      {/* Left rail (desktop only): show info, day nav, day summary, actions. */}
      <aside className="hidden lg:block space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div>
          <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
          <h1 className="text-2xl font-extrabold tracking-tight mt-2">{show.name}</h1>
          {showMeta && <p className="text-sm text-muted mt-1">{showMeta}</p>}
        </div>

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
            <Link
              href={nextDay ? `?day=${nextDay.day_number}` : '#'}
              aria-label="Next day"
              className={cn(
                'rounded-full bg-surface-2 border border-line h-9 w-9 flex items-center justify-center shrink-0',
                !nextDay ? 'pointer-events-none opacity-30' : 'hover:border-accent hover:text-accent',
              )}
            >
              ›
            </Link>
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
            <div key={room.id} className="rounded-card border border-line bg-surface overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-line">
                <h2 className="text-lg font-bold text-ink">{room.name}</h2>
                <RoomActionsMenu roomId={room.id} roomName={room.name} crewCount={crew.length} />
              </div>

              {crew.length > 0 && <BatchPunchBar timecards={crew} dayDate={activeDay.date} />}

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
                  <p className="text-sm text-muted p-4">No crew staffed yet.</p>
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
                />
              </div>
            </div>
          )
        })}
      </div>

      <MobileRoomTracker
        className="lg:hidden min-w-0"
        showId={id}
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
      />
    </div>
  )
}
