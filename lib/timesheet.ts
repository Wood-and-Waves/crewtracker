// Per-crew plain-text timesheet — the thing you text or share to a crew member
// so they can check their own hours.
//
// Plain module (no 'use client') so the server-rendered reports page can build
// the text and hand it down as a string — see CLAUDE.md on the client/server
// export rule.
//
// Port of iOS ShowReportView.generateTimesheetText(), with one deliberate
// difference: NO dollar figures. iOS prints meal-penalty amounts and a
// "Meal Penalty Total: $x" footer even on shows with financials switched off.
// Here the penalty COUNT is kept (crew want to know they earned one) and every
// dollar amount is dropped, so this is always safe to send to a crew member.

import {
  calculateNetHours,
  displayMealBreakMinutes,
  isShortTurnaround,
  mealPenaltyCount,
  paidDoubleTimeHours,
  paidOvertimeHours,
  type PayrollRuleset,
  type TimecardLike,
} from '@/lib/payroll'
import { formatPunchTime, MEAL_PAIRS, mealLabel, type Punch, type PunchType } from '@/lib/punches'

export type TimesheetEntry = {
  /** The work day's date, 'YYYY-MM-DD'. */
  date: string
  timecard: TimecardLike
}

/** Trims trailing zeros the way Swift's Double.formatted() does: 4.0 -> "4". */
function num(n: number): string {
  const r = Math.round(n * 100) / 100
  return Number.isInteger(r) ? String(r) : String(r)
}

function travelRateLabel(ruleset: PayrollRuleset): string {
  return ruleset.travel_rate === 'fullDay' ? 'Full Day' : 'Half Day'
}

function punchAt(tc: TimecardLike, type: PunchType): string | null {
  return tc.punches.find(p => p.punch_type === type)?.punched_at ?? null
}

/** 'Thu, Jul 16' — from a date-only string, never a bare parse (item 8 class). */
function dayHeading(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export function buildTimesheetText({
  showName,
  crewName,
  role,
  entries,
  allTimecards,
  ruleset,
  roundingMinutes = 1,
  timezone,
  use24Hour = false,
}: {
  showName: string
  crewName: string
  role: string
  entries: TimesheetEntry[]
  /** Whole show, so short-turnaround detection can see the previous day. */
  allTimecards: TimecardLike[]
  ruleset: PayrollRuleset
  roundingMinutes?: number
  timezone: string
  use24Hour?: boolean
}): string {
  const rate = travelRateLabel(ruleset)
  let out = `Show: ${showName}\nCrew: ${crewName}${role ? ` (${role})` : ''}\n\n`

  let travelDays = 0
  let workDays = 0
  let sumPaidOT = 0
  let sumPaidDT = 0

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))

  for (const { date, timecard: tc } of sorted) {
    out += `- ${dayHeading(date)} -\n`

    // Pure travel day: flat pay, no punches, nothing else to report.
    if (tc.is_travel_day) {
      travelDays++
      out += `• Travel Day (${rate})\n\n`
      continue
    }

    // Hybrid legs each count toward the travel total, as on iOS.
    if (tc.travel_in_day) travelDays++
    if (tc.travel_out_day) travelDays++

    const start = punchAt(tc, 'start')
    const end = punchAt(tc, 'end')
    out += start && end
      ? `• ${formatPunchTime(start, timezone, use24Hour)} to ${formatPunchTime(end, timezone, use24Hour)}\n`
      : '• Missing Punches\n'

    if (tc.travel_in_day) out += `• Travel In (${rate})\n`
    if (tc.travel_out_day) out += `• Travel Out (${rate})\n`

    // Breaks are reported CAPPED at the deduction cap, so the number shown
    // matches what was actually deducted — a 3hr hold with a 60min cap reads
    // "60 min", not "180 min". Pairs are walked explicitly rather than via
    // mealBreakDurations() so an M2-only break can't be mislabelled as M1.
    for (const [index, [outType, inType]] of MEAL_PAIRS.entries()) {
      const label = mealLabel(index)
      const o = punchAt(tc, outType)
      const i = punchAt(tc, inType)
      if (o && i) {
        const seconds = (new Date(i).getTime() - new Date(o).getTime()) / 1000
        out += `• ${label} Break: ${displayMealBreakMinutes(seconds, ruleset)} min\n`
      }
    }

    // Count only — no amount. See the note at the top of this file.
    const mp = mealPenaltyCount(tc, ruleset)
    if (mp > 0) out += `• Meal Penalties: ${mp}\n`

    if (tc.pay_as_half_day && calculateNetHours(tc, ruleset, roundingMinutes) <= 5) {
      out += '• Half Day Pay\n'
    }

    const ot = paidOvertimeHours(tc, allTimecards, ruleset, roundingMinutes)
    sumPaidOT += ot
    if (ot > 0) out += `• OT Paid: ${num(ot)}h\n`

    const dt = paidDoubleTimeHours(tc, allTimecards, ruleset, roundingMinutes)
    sumPaidDT += dt
    if (dt > 0) {
      const label = isShortTurnaround(tc, allTimecards, ruleset) ? 'ST Penalty (DT)' : 'DT'
      out += `• ${label} Paid: ${num(dt)}h\n`
    }

    // Only a day with both punches counts as worked; a half day counts 0.5.
    if (start && end) workDays += tc.pay_as_half_day ? 0.5 : 1

    out += '\n'
  }

  out += '----------------\n'
  out += `Travel Days: ${travelDays}\n`
  out += `Work Days: ${num(workDays)}\n`
  if (sumPaidOT > 0) out += `Overtime Hours (Paid): ${num(sumPaidOT)}\n`
  if (sumPaidDT > 0) out += `Double Time Hours (Paid): ${num(sumPaidDT)}\n`

  return out
}

/** Wraps a timesheet in the message body iOS sends over SMS. */
export function buildSmsMessage(crewName: string, showName: string, timesheet: string): string {
  const firstName = crewName.trim().split(/\s+/)[0] || crewName
  return (
    `Hi ${firstName},\n\n` +
    `Here are your hours for ${showName}:\n\n` +
    `${timesheet}\n` +
    `Please let me know if this does not match your records.\n\n` +
    `Created with the CrewTracker app`
  )
}
