// Ported from CrewTracker iOS PayrollCalculator (Models.swift)
// Stateless functions, no DB dependency.

export type PunchRecord = { punch_type: string; punched_at: string }

export type PayrollRuleset = {
  overtime_after_hours: number
  double_time_enabled: boolean
  double_time_after_hours: number
  travel_rate: 'halfDay' | 'fullDay'
  meal_penalty_enabled: boolean
  meal_penalty_grace_period: number
  meal_penalty_amount: number
  minimum_meal_break_enabled: boolean
  minimum_meal_break_minutes: number
  meal_break_deduction_cap: number
  short_turn_penalty_enabled: boolean
  short_turn_rest_hours: number
}

export type TimecardInput = {
  day_rate: number
  is_travel_day: boolean
  travel_in_day: boolean
  travel_out_day: boolean
  pay_as_half_day: boolean
  punches: PunchRecord[]
}

function getPunchTime(punches: PunchRecord[], type: string): Date | null {
  const p = punches.find(p => p.punch_type === type)
  return p ? new Date(p.punched_at) : null
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60000
}

// Minutes actually deducted for one meal break, per ruleset rules.
// Breaks under minimumMealBreakMinutes = no deduction (working lunch).
// Breaks at/over that = deduct up to mealBreakDeductionCap.
function deductedMinutesForBreak(rawMinutes: number, ruleset: PayrollRuleset): number {
  if (rawMinutes <= 0) return 0
  if (ruleset.minimum_meal_break_enabled && rawMinutes < ruleset.minimum_meal_break_minutes) {
    return 0
  }
  return Math.min(rawMinutes, ruleset.meal_break_deduction_cap)
}

// Raw (undeducted) meal break durations, for display purposes.
export function rawMealBreakMinutes(timecard: TimecardInput): { m1: number; m2: number } {
  const { punches } = timecard
  const mealOut = getPunchTime(punches, 'meal_out')
  const mealIn = getPunchTime(punches, 'meal_in')
  const meal2Out = getPunchTime(punches, 'meal2_out')
  const meal2In = getPunchTime(punches, 'meal2_in')

  const m1 = mealOut && mealIn ? minutesBetween(mealOut, mealIn) : 0
  const m2 = meal2Out && meal2In ? minutesBetween(meal2Out, meal2In) : 0
  return { m1, m2 }
}

// Caps the meal-break duration shown in SMS timesheets/displays.
export function displayMealBreakMinutes(rawMinutes: number, ruleset: PayrollRuleset): number {
  return Math.min(rawMinutes, ruleset.meal_break_deduction_cap)
}

// Net hours worked for the day, after meal deductions.
export function calculateNetHours(timecard: TimecardInput, ruleset: PayrollRuleset): number {
  const start = getPunchTime(timecard.punches, 'start')
  const end = getPunchTime(timecard.punches, 'end')
  if (!start || !end) return 0

  const totalMinutes = minutesBetween(start, end)
  const { m1, m2 } = rawMealBreakMinutes(timecard)
  const deducted = deductedMinutesForBreak(m1, ruleset) + deductedMinutesForBreak(m2, ruleset)

  return Math.max(0, (totalMinutes - deducted) / 60)
}

// Splits a day's net hours into ST/OT/DT, given ruleset thresholds.
// forcedDoubleTime = true when a short-turnaround penalty applies (whole day at DT).
function splitHours(netHours: number, ruleset: PayrollRuleset, forcedDoubleTime = false) {
  if (forcedDoubleTime) {
    return { st: 0, ot: 0, dt: netHours }
  }

  const otThreshold = ruleset.overtime_after_hours
  const dtThreshold = ruleset.double_time_enabled ? ruleset.double_time_after_hours : Infinity

  const st = Math.min(netHours, otThreshold)
  const ot = Math.max(0, Math.min(netHours, dtThreshold) - otThreshold)
  const dt = Math.max(0, netHours - dtThreshold)

  return { st, ot, dt }
}

export function straightTimeHours(timecard: TimecardInput, ruleset: PayrollRuleset, forcedDoubleTime = false): number {
  return splitHours(calculateNetHours(timecard, ruleset), ruleset, forcedDoubleTime).st
}

export function overtimeHours(timecard: TimecardInput, ruleset: PayrollRuleset, forcedDoubleTime = false): number {
  return splitHours(calculateNetHours(timecard, ruleset), ruleset, forcedDoubleTime).ot
}

export function doubleTimeHours(timecard: TimecardInput, ruleset: PayrollRuleset, forcedDoubleTime = false): number {
  return splitHours(calculateNetHours(timecard, ruleset), ruleset, forcedDoubleTime).dt
}

// "Paid" variant: ceiling-round net hours to the next full hour BEFORE
// splitting into ST/OT/DT. This is the billable/payable figure.
export function paidNetHours(timecard: TimecardInput, ruleset: PayrollRuleset): number {
  const net = calculateNetHours(timecard, ruleset)
  return net > 0 ? Math.ceil(net) : 0
}

export function paidStraightTimeHours(timecard: TimecardInput, ruleset: PayrollRuleset, forcedDoubleTime = false): number {
  return splitHours(paidNetHours(timecard, ruleset), ruleset, forcedDoubleTime).st
}

export function paidOvertimeHours(timecard: TimecardInput, ruleset: PayrollRuleset, forcedDoubleTime = false): number {
  return splitHours(paidNetHours(timecard, ruleset), ruleset, forcedDoubleTime).ot
}

export function paidDoubleTimeHours(timecard: TimecardInput, ruleset: PayrollRuleset, forcedDoubleTime = false): number {
  return splitHours(paidNetHours(timecard, ruleset), ruleset, forcedDoubleTime).dt
}

// Meal penalty: triggered if crew exceed the grace period without a meal break.
// Max 2 per day (one per meal period).
export function mealPenaltyCount(timecard: TimecardInput, ruleset: PayrollRuleset): number {
  if (!ruleset.meal_penalty_enabled) return 0

  const start = getPunchTime(timecard.punches, 'start')
  const end = getPunchTime(timecard.punches, 'end')
  if (!start || !end) return 0

  const mealOut = getPunchTime(timecard.punches, 'meal_out')
  const mealIn = getPunchTime(timecard.punches, 'meal_in')
  const meal2Out = getPunchTime(timecard.punches, 'meal2_out')

  let count = 0
  const graceMinutes = ruleset.meal_penalty_grace_period * 60

  // Period 1: start -> first meal (or end, if no meal taken)
  const period1End = mealOut || end
  if (minutesBetween(start, period1End) > graceMinutes && !mealOut) {
    count += 1
  }

  // Period 2: end of meal 1 -> second meal (or end, if no second meal taken)
  if (mealIn) {
    const period2End = meal2Out || end
    if (minutesBetween(mealIn, period2End) > graceMinutes && !meal2Out) {
      count += 1
    }
  }

  return Math.min(count, 2)
}

export function mealPenaltyTotal(timecard: TimecardInput, ruleset: PayrollRuleset): number {
  const count = mealPenaltyCount(timecard, ruleset)
  if (count === 0) return 0
  const amount = ruleset.meal_penalty_amount > 0
    ? ruleset.meal_penalty_amount
    : hourlyRate(timecard.day_rate, ruleset) * 1.5 // defaults to OT hourly rate
  return count * amount
}

export function hourlyRate(dayRate: number, ruleset: PayrollRuleset): number {
  return dayRate / ruleset.overtime_after_hours
}

// Travel pay for a day: pure travel day (isTravelDay) or additive
// travel-in/travel-out legs on a hybrid work+travel day.
export function travelPayAmount(timecard: TimecardInput, ruleset: PayrollRuleset): number {
  const multiplier = ruleset.travel_rate === 'halfDay' ? 0.5 : 1
  let total = 0

  if (timecard.is_travel_day) {
    total += timecard.day_rate * multiplier
  }
  if (timecard.travel_in_day) {
    total += timecard.day_rate * multiplier
  }
  if (timecard.travel_out_day) {
    total += timecard.day_rate * multiplier
  }

  return total
}

// Whether the gap between previous day's end punch and this day's start
// punch is short enough to trigger the forced-double-time rule.
export function isShortTurnaround(
  previousDayEnd: Date | null,
  currentDayStart: Date | null,
  ruleset: PayrollRuleset
): boolean {
  if (!ruleset.short_turn_penalty_enabled || !previousDayEnd || !currentDayStart) return false
  const restHours = minutesBetween(previousDayEnd, currentDayStart) / 60
  return restHours < ruleset.short_turn_rest_hours
}

// Total pay for a single day: worked hours + travel + meal penalties,
// with a minimum-guarantee floor of the full day rate.
export function totalPay(timecard: TimecardInput, ruleset: PayrollRuleset, forcedDoubleTime = false): number {
  if (timecard.is_travel_day && timecard.punches.length === 0) {
    return travelPayAmount(timecard, ruleset)
  }

  const rate = hourlyRate(timecard.day_rate, ruleset)
  const { st, ot, dt } = splitHours(calculateNetHours(timecard, ruleset), ruleset, forcedDoubleTime)

  let pay = st * rate + ot * rate * 1.5 + dt * rate * 2
  pay = Math.max(pay, timecard.day_rate) // minimum guarantee
  pay += travelPayAmount(timecard, ruleset)
  pay += mealPenaltyTotal(timecard, ruleset)

  return pay
}
