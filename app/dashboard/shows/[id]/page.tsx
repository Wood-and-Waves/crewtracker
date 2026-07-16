import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import AddRoomModal from '@/components/AddRoomModal'
import StaffRoomModal from '@/components/StaffRoomModal'
import TimecardRow from '@/components/TimecardRow'
import BatchPunchBar from '@/components/BatchPunchBar'
import RoomActionsMenu from '@/components/RoomActionsMenu'
import { PUNCH_ORDER, PUNCH_LABELS } from '@/lib/punches'
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

  return (
    <div className="p-6 md:p-10">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight mt-2">{show.name}</h1>
        <div className="flex gap-2 mt-2">
          <Link href={`/dashboard/shows/${id}/edit`}>
            <Button variant="ghost" size="sm">Edit Show</Button>
          </Link>
          <Link href={`/dashboard/shows/${id}/reports`}>
            <Button variant="ghost" size="sm">View Report</Button>
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 my-6">
        <Link
          href={prevDay ? `?day=${prevDay.day_number}` : '#'}
          className={cn(
            'rounded-full bg-surface-2 border border-line p-2 h-9 w-9 flex items-center justify-center',
            !prevDay ? 'pointer-events-none opacity-30' : 'hover:border-accent hover:text-accent',
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
          className={cn(
            'rounded-full bg-surface-2 border border-line p-2 h-9 w-9 flex items-center justify-center',
            !nextDay ? 'pointer-events-none opacity-30' : 'hover:border-accent hover:text-accent',
          )}
        >
          ›
        </Link>
      </div>

      <div className="flex justify-end mb-3">
        <AddRoomModal
          showId={id}
          currentWorkDayId={activeDay.id}
          remainingWorkDayIds={remainingWorkDayIds}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {roomsList.map(room => {
          const crew = roomTimecards[room.id] || []
          return (
            <div key={room.id} className="rounded-card border border-line bg-surface overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-line">
                <h2 className="text-lg font-bold text-ink">{room.name}</h2>
                <RoomActionsMenu roomId={room.id} roomName={room.name} crewCount={crew.length} />
              </div>

              {crew.length > 0 && <BatchPunchBar timecards={crew} />}

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
    </div>
  )
}
