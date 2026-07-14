'use client'

import {
  straightTimeHours, overtimeHours, doubleTimeHours,
  paidStraightTimeHours, paidOvertimeHours, paidDoubleTimeHours,
  mealPenaltyCount, mealPenaltyTotal, travelLegPay, totalPay, isShortTurnaround,
  TimecardLike, PayrollRuleset,
} from '@/lib/payroll'

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function fmt2(n: number): string {
  return n.toFixed(2)
}

export default function ExportCSVButton({
  showName,
  showFinancials,
  rooms,
  workDays,
  timecards,
  punches,
  ruleset,
  timezone,
}: {
  showName: string
  rooms: any[]
  workDays: any[]
  timecards: any[]
  punches: any[]
  ruleset: PayrollRuleset
  timezone: string
  showFinancials: boolean
}) {
  function timeLabel(iso: string | undefined) {
    if (!iso) return ''
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone })
  }

  function dateLabel(dateStr: string | undefined) {
    if (!dateStr) return ''
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US')
  }

  function toTc(rawTc: any): TimecardLike {
    return {
      id: rawTc.id,
      crew_member_id: rawTc.crew_member_id,
      day_rate: rawTc.day_rate,
      is_travel_day: rawTc.is_travel_day,
      travel_in_day: rawTc.travel_in_day,
      travel_out_day: rawTc.travel_out_day,
      pay_as_half_day: rawTc.pay_as_half_day,
      punches: punches.filter((p: any) => p.timecard_id === rawTc.id),
    }
  }

  function exportCSV() {
    const allTimecards: TimecardLike[] = timecards.map(toTc)

    const header = 'Name,Role,Date,Room,Travel Day,Travel In,Travel Out,Half Day,Start Time,Meal 1 Out,Meal 1 In,Meal 2 Out,Meal 2 In,Wrap Time,ST Hours,OT Hours,DT Hours,ST Paid,OT Paid,DT Paid,Meal Penalties,Meal Penalty Total,Short Turnaround,Travel Pay,Total Pay'
    const rows = [header]

    const sorted = [...timecards].sort((a, b) => {
      const wdA = workDays.find(d => rooms.find(r => r.id === a.room_id)?.work_day_id === d.id)
      const wdB = workDays.find(d => rooms.find(r => r.id === b.room_id)?.work_day_id === d.id)
      return (wdA?.date || '').localeCompare(wdB?.date || '')
    })

    let totalST = 0, totalOT = 0, totalDT = 0
    let totalPaidST = 0, totalPaidOT = 0, totalPaidDT = 0
    let totalMealPenaltyCount = 0, totalMealPenalty = 0
    let totalTravelPay = 0, totalLaborCost = 0
    let travelDayCount = 0, travelInCount = 0, travelOutCount = 0, halfDayCount = 0, shortTurnCount = 0

    for (const rawTc of sorted) {
      const tc = toTc(rawTc)
      const wd = workDays.find(d => rooms.find(r => r.id === rawTc.room_id)?.work_day_id === d.id)
      const room = rooms.find(r => r.id === rawTc.room_id)

      const p = (type: string) => punches.find((pp: any) => pp.timecard_id === rawTc.id && pp.punch_type === type)?.punched_at

      const st = straightTimeHours(tc, allTimecards, ruleset)
      const ot = overtimeHours(tc, allTimecards, ruleset)
      const dt = doubleTimeHours(tc, allTimecards, ruleset)
      const pST = paidStraightTimeHours(tc, allTimecards, ruleset)
      const pOT = paidOvertimeHours(tc, allTimecards, ruleset)
      const pDT = paidDoubleTimeHours(tc, allTimecards, ruleset)
      const mpCount = mealPenaltyCount(tc, ruleset)
      const mpTotal = mealPenaltyTotal(tc, ruleset)
      const shortTurn = isShortTurnaround(tc, allTimecards, ruleset)
      const travelPay = travelLegPay(tc, ruleset)
      const pay = totalPay(tc, allTimecards, ruleset)

      totalST += st; totalOT += ot; totalDT += dt
      totalPaidST += pST; totalPaidOT += pOT; totalPaidDT += pDT
      totalMealPenaltyCount += mpCount; totalMealPenalty += mpTotal
      totalTravelPay += travelPay; totalLaborCost += pay
      if (rawTc.is_travel_day) travelDayCount++
      if (rawTc.travel_in_day) travelInCount++
      if (rawTc.travel_out_day) travelOutCount++
      if (rawTc.pay_as_half_day) halfDayCount++
      if (shortTurn) shortTurnCount++

      const row = [
        csvField(rawTc.crew_member_name),
        csvField(rawTc.role),
        csvField(dateLabel(wd?.date)),
        csvField(room?.name || ''),
        csvField(rawTc.is_travel_day ? 'Yes' : 'No'),
        csvField(rawTc.travel_in_day ? 'Yes' : 'No'),
        csvField(rawTc.travel_out_day ? 'Yes' : 'No'),
        csvField(rawTc.pay_as_half_day ? 'Yes' : 'No'),
        csvField(timeLabel(p('start'))),
        csvField(timeLabel(p('meal_out'))),
        csvField(timeLabel(p('meal_in'))),
        csvField(timeLabel(p('meal2_out'))),
        csvField(timeLabel(p('meal2_in'))),
        csvField(timeLabel(p('end'))),
        csvField(fmt2(st)),
        csvField(fmt2(ot)),
        csvField(fmt2(dt)),
        csvField(fmt2(pST)),
        csvField(fmt2(pOT)),
        csvField(fmt2(pDT)),
        csvField(String(mpCount)),
        csvField(showFinancials ? fmt2(mpTotal) : ''),
        csvField(shortTurn ? 'Yes' : 'No'),
        csvField(showFinancials ? fmt2(travelPay) : ''),
        csvField(showFinancials ? fmt2(pay) : ''),
      ].join(',')

      rows.push(row)
    }

    const totalsRow = [
      csvField('TOTALS'), csvField(''), csvField(''), csvField(''),
      csvField(String(travelDayCount)), csvField(String(travelInCount)), csvField(String(travelOutCount)), csvField(String(halfDayCount)),
      csvField(''), csvField(''), csvField(''), csvField(''), csvField(''), csvField(''),
      csvField(fmt2(totalST)), csvField(fmt2(totalOT)), csvField(fmt2(totalDT)),
      csvField(fmt2(totalPaidST)), csvField(fmt2(totalPaidOT)), csvField(fmt2(totalPaidDT)),
      csvField(String(totalMealPenaltyCount)), csvField(showFinancials ? fmt2(totalMealPenalty) : ''),
      csvField(String(shortTurnCount)), csvField(showFinancials ? fmt2(totalTravelPay) : ''), csvField(showFinancials ? fmt2(totalLaborCost) : ''),
    ].join(',')
    rows.push(totalsRow)

    rows.push('')
    rows.push(csvField('Created with the CrewTracker app'))

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${showName.replace(/ /g, '_')}_Payroll.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button onClick={exportCSV} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
      Export CSV
    </button>
  )
}
