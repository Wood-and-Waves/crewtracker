import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import AddRoomModal from '@/components/AddRoomModal'
import StaffRoomModal from '@/components/StaffRoomModal'
import TimecardRow from '@/components/TimecardRow'
import BatchPunchBar from '@/components/BatchPunchBar'
import RoomActionsMenu from '@/components/RoomActionsMenu'

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
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-300">← Back to Shows</Link>
        <h1 className="text-2xl font-bold mt-4">{show.name}</h1>
        <p className="text-zinc-500 mt-2">No days generated for this show yet.</p>
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
      <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-300">← Back to Shows</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold mt-2">{show.name}</h1>
        <div className="flex gap-2">
          <Link href={`/dashboard/shows/${id}/edit`} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
            Edit Show
          </Link>
          <Link href={`/dashboard/shows/${id}/reports`} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
            View Report
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 my-6">
        <Link
          href={prevDay ? `?day=${prevDay.day_number}` : '#'}
          className={`rounded-full bg-zinc-800 p-2 ${!prevDay ? 'pointer-events-none opacity-30' : 'hover:bg-zinc-700'}`}
        >
          ‹
        </Link>
        <div className="text-center">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Day {activeDay.day_number} of {workDays.length}</p>
          <p className="text-lg font-semibold text-white">{dateLabel}</p>
        </div>
        <Link
          href={nextDay ? `?day=${nextDay.day_number}` : '#'}
          className={`rounded-full bg-zinc-800 p-2 ${!nextDay ? 'pointer-events-none opacity-30' : 'hover:bg-zinc-700'}`}
        >
          ›
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roomsList.map(room => (
          <div key={room.id} className="rounded-2xl bg-zinc-900 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white">{room.name}</h2>
              <RoomActionsMenu
                roomId={room.id}
                roomName={room.name}
                crewCount={roomTimecards[room.id]?.length || 0}
              />
            </div>

            {roomTimecards[room.id]?.length > 0 && (
              <BatchPunchBar timecards={roomTimecards[room.id]} />
            )}

            <div className="flex flex-col gap-2 mb-4">
              {roomTimecards[room.id]?.length === 0 && (
                <p className="text-sm text-zinc-500">No crew staffed yet.</p>
              )}
              {roomTimecards[room.id]?.map(tc => (
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

            <StaffRoomModal
              organizationId={profile?.organization_id}
              roomId={room.id}
              roomName={room.name}
              currentWorkDayId={activeDay.id}
              remainingRoomIdsSameName={remainingRoomsByName[room.id] || []}
            />
          </div>
        ))}

        <div className="flex items-center justify-center rounded-2xl border border-dashed border-zinc-800 p-5 min-h-[120px]">
          <AddRoomModal
            showId={id}
            currentWorkDayId={activeDay.id}
            remainingWorkDayIds={remainingWorkDayIds}
          />
        </div>
      </div>
    </div>
  )
}
