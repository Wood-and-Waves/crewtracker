import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  straightTimeHours, overtimeHours, doubleTimeHours,
  paidStraightTimeHours, paidOvertimeHours, paidDoubleTimeHours,
  mealPenaltyCount, isShortTurnaround,
  TimecardLike, PayrollRuleset,
} from '@/lib/payroll'

function fmt(n: number): string {
  if (n === 0) return '0'
  const rounded = Math.round(n * 100) / 100
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

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

  const { data: rulesetRow } = await supabase
    .from('payroll_rulesets')
    .select('*')
    .eq('show_id', id)
    .single()

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

  if (!rulesetRow) {
    return (
      <div className="p-6 md:p-10">
        <Link href={`/dashboard/shows/${id}`} className="text-sm text-zinc-500 hover:text-zinc-300">← Back to Show</Link>
        <h1 className="text-2xl font-bold mt-4">{show.name}</h1>
        <p className="text-zinc-500 mt-2">No payroll ruleset found for this show.</p>
      </div>
    )
  }
  const ruleset: PayrollRuleset = rulesetRow

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

  // Master Summary: PAID (ceiling-rounded) totals across the whole show.
  let totalPaidST = 0, totalPaidOT = 0, totalPaidDT = 0
  for (const tc of allTimecards) {
    totalPaidST += paidStraightTimeHours(tc, allTimecards, ruleset)
    totalPaidOT += paidOvertimeHours(tc, allTimecards, ruleset)
    totalPaidDT += paidDoubleTimeHours(tc, allTimecards, ruleset)
  }
  const totalPaidHours = totalPaidST + totalPaidOT + totalPaidDT

  function dayLabel(dateStr: string) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  }

  function findTc(rawTc: any): TimecardLike {
    return {
      id: rawTc.id,
      crew_member_id: rawTc.crew_member_id,
      day_rate: rawTc.day_rate,
      is_travel_day: rawTc.is_travel_day,
      travel_in_day: rawTc.travel_in_day,
      travel_out_day: rawTc.travel_out_day,
      pay_as_half_day: rawTc.pay_as_half_day,
      punches: (punches || []).filter(p => p.timecard_id === rawTc.id),
    }
  }

  // Matches iOS breakdownString(for:) exactly: raw ST/OT/DT + meal penalty count.
  function breakdownString(rawTc: any) {
    const tc = findTc(rawTc)
    const st = straightTimeHours(tc, allTimecards, ruleset)
    const ot = overtimeHours(tc, allTimecards, ruleset)
    const dt = doubleTimeHours(tc, allTimecards, ruleset)
    const mp = mealPenaltyCount(tc, ruleset)
    const parts = [`${fmt(st)} ST`]
    if (ot > 0) parts.push(`${fmt(ot)} OT`)
    if (dt > 0) parts.push(`${fmt(dt)} DT`)
    if (mp > 0) parts.push(`${mp} MP`)
    return { text: parts.join(' | '), dayTotal: st + ot + dt, shortTurn: isShortTurnaround(tc, allTimecards, ruleset) }
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
          <span className="text-lg font-bold text-white">{fmt(totalPaidHours)} hrs</span>
        </div>
        <div className="flex justify-between mb-2 text-sm text-zinc-500">
          <span>Straight Time</span>
          <span>{fmt(totalPaidST)} hrs</span>
        </div>
        <div className="flex justify-between text-sm text-zinc-500">
          <span>Overtime</span>
          <span>{fmt(totalPaidOT)} hrs</span>
        </div>
        {totalPaidDT > 0 && (
          <div className="flex justify-between text-sm text-zinc-500">
            <span>Double Time</span>
            <span>{fmt(totalPaidDT)} hrs</span>
          </div>
        )}
      </div>

      {activeView === 'day' ? (
        <div className="flex flex-col gap-6">
          {(workDays || []).map(wd => {
            const dayRooms = (rooms || []).filter(r => r.work_day_id === wd.id)
            const dayRoomIds = dayRooms.map(r => r.id)
            const dayTimecards = (timecards || [])
              .filter(t => dayRoomIds.includes(t.room_id))
              .sort((a, b) => a.crew_member_name.localeCompare(b.crew_member_name))

            if (dayTimecards.length === 0) return null

            return (
              <div key={wd.id}>
                <p className="text-sm font-semibold text-zinc-400 mb-2">{dayLabel(wd.date)}</p>
                <div className="rounded-2xl bg-zinc-900 divide-y divide-zinc-800">
                  {dayTimecards.map(tc => {
                    if (tc.is_travel_day) {
                      return (
                        <div key={tc.id} className="flex justify-between p-4">
                          <div>
                            <p className="text-sm text-white">{tc.crew_member_name}</p>
                            <p className="text-xs text-zinc-500">{tc.role}</p>
                          </div>
                          <span className="text-sm font-semibold text-blue-400">Travel Day</span>
                        </div>
                      )
                    }
                    const b = breakdownString(tc)
                    return (
                      <div key={tc.id} className="flex justify-between p-4">
                        <div className="flex items-center gap-1.5">
                          <div>
                            <p className="text-sm text-white">{tc.crew_member_name}</p>
                            <p className="text-xs text-zinc-500">{tc.role}</p>
                          </div>
                          {tc.travel_in_day && <span className="text-xs text-blue-400">✈️</span>}
                          {tc.travel_out_day && <span className="text-xs text-blue-400">✈️</span>}
                          {tc.pay_as_half_day && <span className="text-xs text-purple-400">◑</span>}
                          {b.shortTurn && <span className="text-xs text-orange-400">⚠️</span>}
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-semibold ${b.shortTurn ? 'text-orange-400' : 'text-white'}`}>
                            {fmt(b.dayTotal)} hrs
                          </p>
                          <p className="text-xs text-zinc-500">{b.text}</p>
                        </div>
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
              const key = `${tc.crew_member_name}|${tc.role}`
              if (!acc[key]) acc[key] = { name: tc.crew_member_name, role: tc.role, entries: [] }
              acc[key].entries.push(tc)
              return acc
            }, {})
          )
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
            .map((crew: any) => {
              let crewTotal = 0

              return (
                <div key={crew.name} className="rounded-2xl bg-zinc-900 p-5">
                  <h2 className="text-lg font-bold text-white mb-1">{crew.name}</h2>
                  <p className="text-xs text-zinc-500 mb-3">{crew.role}</p>

                  <div className="flex flex-col gap-2 mb-3">
                    {crew.entries
                      .slice()
                      .sort((a: any, b: any) => {
                        const wdA = (workDays || []).find(d => (rooms || []).find(r => r.id === a.room_id)?.work_day_id === d.id)
                        const wdB = (workDays || []).find(d => (rooms || []).find(r => r.id === b.room_id)?.work_day_id === d.id)
                        return (wdA?.date || '').localeCompare(wdB?.date || '')
                      })
                      .map((tc: any) => {
                        const wd = (workDays || []).find(d => {
                          const r = (rooms || []).find(rr => rr.id === tc.room_id)
                          return r?.work_day_id === d.id
                        })

                        if (tc.is_travel_day) {
                          return (
                            <div key={tc.id} className="flex justify-between text-sm">
                              <span className="text-zinc-400">{wd ? dayLabel(wd.date) : ''}</span>
                              <span className="font-semibold text-blue-400">Travel Day</span>
                            </div>
                          )
                        }

                        const b = breakdownString(tc)
                        crewTotal += b.dayTotal

                        return (
                          <div key={tc.id} className="flex justify-between text-sm">
                            <span className="text-zinc-400 flex items-center gap-1">
                              {wd ? dayLabel(wd.date) : ''}
                              {b.shortTurn && <span className="text-orange-400">⚠️</span>}
                              {tc.travel_in_day && <span className="text-blue-400">✈️</span>}
                              {tc.travel_out_day && <span className="text-blue-400">✈️</span>}
                              {tc.pay_as_half_day && <span className="text-purple-400">◑</span>}
                            </span>
                            <div className="text-right">
                              <p className={`font-semibold ${b.shortTurn ? 'text-orange-400' : 'text-white'}`}>{fmt(b.dayTotal)} hrs</p>
                              <p className="text-xs text-zinc-500">{b.text}</p>
                            </div>
                          </div>
                        )
                      })}
                  </div>

                  <div className="border-t border-zinc-800 pt-3 flex justify-between">
                    <span className="text-sm font-semibold text-white">Total Show Hours</span>
                    <span className="text-sm font-semibold text-white">{fmt(crewTotal)} hrs</span>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
