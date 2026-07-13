import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  straightTimeHours, overtimeHours, doubleTimeHours,
  paidStraightTimeHours, paidOvertimeHours, paidDoubleTimeHours,
  TimecardLike, PayrollRuleset,
} from '@/lib/payroll'

export default async function ShowReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { id } = await params
  const { view } = await searchParams
  const activeView = view === 'crew' ? 'crew' : 'day'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: show } = await supabase.from('shows').select('*').eq('id', id).single()
  if (!show) notFound()

  const timezone = show.timezone_identifier || 'America/Chicago'

  const { data: ruleset } = await supabase
    .from('payroll_rulesets')
    .select('*')
    .eq('show_id', id)
    .single() as { data: PayrollRuleset | null }

  const { data: workDays } = await supabase
    .from('work_days')
    .select('*')
    .eq('show_id', id)
    .order('day_number')

  const workDayIds = (workDays || []).map(d => d.id)

  const { data: rooms } = workDayIds.length > 0
    ? await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', workDayIds)
    : { data: [] }

  const roomIds = (rooms || []).map(r => r.id)

  const { data: timecards } = roomIds.length > 0
    ? await supabase.from('timecards').select('*').in('room_id', roomIds)
    : { data: [] }

  const timecardIds = (timecards || []).map(t => t.id)

  const { data: punches } = timecardIds.length > 0
    ? await supabase.from('punches').select('*').in('timecard_id', timecardIds)
    : { data: [] }

  const allTimecards: TimecardLike[] = (timecards || []).map(tc => ({
    id: tc.id,
    crew_member_id: tc.crew_member_id,
    day_rate: tc.day_rate,
    is_travel_day: tc.is_travel_day,
    travel_in_day: tc.travel_in_day,
    travel_out_day: tc.travel_out_day,
    pay_as_half_day: tc.pay_as_half_day,
    punches: (punches || []).filter(p => p.timecard_id === tc.id),
  }))

  if (!ruleset) {
    return (
      <div className="p-6 md:p-10">
        <Link href={`/dashboard/shows/${id}`} className="text-sm text-zinc-500 hover:text-zinc-300">← Back to Show</Link>
        <h1 className="text-2xl font-bold mt-4">{show.name}</h1>
        <p className="text-zinc-500 mt-2">No payroll ruleset found for this show.</p>
      </div>
    )
  }

  const safeRuleset = ruleset

  // Master summary: sum PAID hours across every timecard in the show.
  let totalST = 0, totalOT = 0, totalDT = 0
  for (const tc of allTimecards) {
    totalST += paidStraightTimeHours(tc, allTimecards, safeRuleset)
    totalOT += paidOvertimeHours(tc, allTimecards, safeRuleset)
    totalDT += paidDoubleTimeHours(tc, allTimecards, safeRuleset)
  }
  const totalPaidHours = totalST + totalOT + totalDT

  function dayLabel(dateStr: string) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    })
  }

  function timeLabel(iso: string) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone })
  }

  function tcSummary(rawTc: any) {
    const tc: TimecardLike = {
      id: rawTc.id,
      crew_member_id: rawTc.crew_member_id,
      day_rate: rawTc.day_rate,
      is_travel_day: rawTc.is_travel_day,
      travel_in_day: rawTc.travel_in_day,
      travel_out_day: rawTc.travel_out_day,
      pay_as_half_day: rawTc.pay_as_half_day,
      punches: (punches || []).filter(p => p.timecard_id === rawTc.id),
    }
    const wST = straightTimeHours(tc, allTimecards, safeRuleset)
    const wOT = overtimeHours(tc, allTimecards, safeRuleset)
    const wDT = doubleTimeHours(tc, allTimecards, safeRuleset)
    const pST = paidStraightTimeHours(tc, allTimecards, safeRuleset)
    const pOT = paidOvertimeHours(tc, allTimecards, safeRuleset)
    const pDT = paidDoubleTimeHours(tc, allTimecards, safeRuleset)
    return { wST, wOT, wDT, pST, pOT, pDT }
  }

  return (
    <div className="p-6 md:p-10">
      <Link href={`/dashboard/shows/${id}`} className="text-sm text-zinc-500 hover:text-zinc-300">← Back to Show</Link>
      <h1 className="text-2xl font-bold mt-2 mb-6">{show.name} — Report</h1>

      <div className="flex gap-2 mb-6">
        <Link
          href="?view=day"
          className={`rounded-full px-4 py-2 text-sm font-medium ${activeView === 'day' ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400'}`}
        >
          By Day
        </Link>
        <Link
          href="?view=crew"
          className={`rounded-full px-4 py-2 text-sm font-medium ${activeView === 'crew' ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400'}`}
        >
          By Crew
        </Link>
      </div>

      <div className="rounded-2xl bg-zinc-900 p-5 mb-6 max-w-md">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-zinc-400">Total Crew Hours (Paid)</span>
          <span className="text-lg font-bold text-white">{totalPaidHours.toFixed(2)} hrs</span>
        </div>
        <div className="flex justify-between mb-2 text-sm text-zinc-500">
          <span>Straight Time</span>
          <span>{totalST.toFixed(2)} hrs</span>
        </div>
        <div className="flex justify-between text-sm text-zinc-500">
          <span>Overtime</span>
          <span>{totalOT.toFixed(2)} hrs</span>
        </div>
        {totalDT > 0 && (
          <div className="flex justify-between text-sm text-zinc-500">
            <span>Double Time</span>
            <span>{totalDT.toFixed(2)} hrs</span>
          </div>
        )}
      </div>

      {activeView === 'day' ? (
        <div className="flex flex-col gap-6">
          {(workDays || []).map(wd => {
            const dayRooms = (rooms || []).filter(r => r.work_day_id === wd.id)
            const dayRoomIds = dayRooms.map(r => r.id)
            const dayTimecards = (timecards || []).filter(t => dayRoomIds.includes(t.room_id))

            if (dayTimecards.length === 0) return null

            return (
              <div key={wd.id}>
                <p className="text-sm font-semibold text-zinc-400 mb-2">{dayLabel(wd.date)}</p>
                <div className="rounded-2xl bg-zinc-900 divide-y divide-zinc-800">
                  {dayTimecards.map(tc => {
                    const room = dayRooms.find(r => r.id === tc.room_id)
                    if (tc.is_travel_day) {
                      return (
                        <div key={tc.id} className="flex justify-between p-4">
                          <div>
                            <p className="text-sm text-white">{tc.crew_member_name}</p>
                            <p className="text-xs text-zinc-500">{tc.role} · {room?.name}</p>
                          </div>
                          <span className="text-sm text-blue-400">Travel Day</span>
                        </div>
                      )
                    }
                    const s = tcSummary(tc)
                    return (
                      <div key={tc.id} className="flex justify-between p-4">
                        <div>
                          <p className="text-sm text-white">{tc.crew_member_name}</p>
                          <p className="text-xs text-zinc-500">{tc.role} · {room?.name}</p>
                        </div>
                        <span className="text-sm text-zinc-300">
                          {(s.pST + s.pOT + s.pDT).toFixed(2)} hrs
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Object.values(
            (timecards || []).reduce((acc: Record<string, any>, tc) => {
              const key = tc.crew_member_id || tc.crew_member_name
              if (!acc[key]) acc[key] = { name: tc.crew_member_name, role: tc.role, entries: [] }
              acc[key].entries.push(tc)
              return acc
            }, {})
          ).map((crew: any) => {
            let personST = 0, personOT = 0, personDT = 0
            let personWST = 0, personWOT = 0, personWDT = 0

            return (
              <div key={crew.name} className="rounded-2xl bg-zinc-900 p-5">
                <h2 className="text-lg font-bold text-white mb-1">{crew.name}</h2>
                <p className="text-xs text-zinc-500 mb-3">{crew.role}</p>

                <div className="flex flex-col gap-2 mb-3">
                  {crew.entries.map((tc: any) => {
                    const wd = (workDays || []).find(d => {
                      const r = (rooms || []).find(rr => rr.id === tc.room_id)
                      return r?.work_day_id === d.id
                    })

                    if (tc.is_travel_day) {
                      return (
                        <div key={tc.id} className="flex justify-between text-sm">
                          <span className="text-zinc-400">{wd ? dayLabel(wd.date) : ''}</span>
                          <span className="text-blue-400">Travel Day</span>
                        </div>
                      )
                    }

                    const s = tcSummary(tc)
                    personST += s.pST; personOT += s.pOT; personDT += s.pDT
                    personWST += s.wST; personWOT += s.wOT; personWDT += s.wDT

                    const start = (punches || []).find(p => p.timecard_id === tc.id && p.punch_type === 'start')
                    const end = (punches || []).find(p => p.timecard_id === tc.id && p.punch_type === 'end')

                    return (
                      <div key={tc.id} className="flex justify-between text-sm">
                        <span className="text-zinc-400">
                          {wd ? dayLabel(wd.date) : ''}
                          {start && end && ` · ${timeLabel(start.punched_at)}–${timeLabel(end.punched_at)}`}
                        </span>
                        <span className="text-zinc-300">{(s.pST + s.pOT + s.pDT).toFixed(2)} hrs</span>
                      </div>
                    )
                  })}
                </div>

                <div className="border-t border-zinc-800 pt-3 text-xs">
                  <p className="text-zinc-500">
                    Worked: {personWST.toFixed(2)} ST / {personWOT.toFixed(2)} OT / {personWDT.toFixed(2)} DT
                  </p>
                  <p className="text-white font-medium">
                    Paid: {personST.toFixed(2)} ST / {personOT.toFixed(2)} OT / {personDT.toFixed(2)} DT
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
