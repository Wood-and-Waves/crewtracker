// Faithful TypeScript port of the CrewTracker iOS PayrollCalculator
// (Models.swift). Stateless functions, no DB dependency.
//
// NOTE: TravelRate raw values are assumed to be 'halfDay' / 'fullDay' in
// the Postgres schema (per the web app brief), NOT the iOS raw strings
// ("Half Day" / "Full Day"). This has not been verified against the actual
// stored column values — confirm in Supabase if travel pay looks wrong.
//
// NOTE: iOS applies a user-configurable time-rounding setting (exact /
// nearest 15 / nearest 30) via UserDefaults before computing net hours.
// The web app has no equivalent setting yet, so calculateNetHours defaults
// to exact-minute rounding (roundingMinutes = 1) until that setting exists.

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

export type TimecardLike = {
  id: string
  crew_member_id: string | null
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

function mealBreakPairs(tc: TimecardLike): [Date, Date][] {
  const pairs: [Date, Date][] = []
  const m1Out = getPunchTime(tc.punches, 'meal_out')
  const m1In = getPunchTime(tc.punches, 'meal_in')
  const m2Out = getPunchTime(tc.punches, 'meal2_out')
  const m2In = getPunchTime(tc.punches, 'meal2_in')
  if (m1Out && m1In) pairs.push([m1Out, m1In])
  if (m2Out && m2In) pairs.push([m2Out, m2In])
  return pairs
}

const DISTANT_PAST = new Date(-8640000000000000)

// MARK: Net Hours

export function calculateNetHours(tc: TimecardLike, ruleset: PayrollRuleset, roundingMinutes: number = 1): number {
  const start = getPunchTime(tc.punches, 'start')
  const end = getPunchTime(tc.punches, 'end')
  if (!start || !end) return 0

  const grossSeconds = (end.getTime() - start.getTime()) / 1000
  const minBreakSeconds = ruleset.minimum_meal_break_enabled ? ruleset.minimum_meal_break_minutes * 60 : 0
  const capSeconds = ruleset.meal_break_deduction_cap * 60

  let deductionSeconds = 0
  for (const [outP, inP] of mealBreakPairs(tc)) {
    const duration = (inP.getTime() - outP.getTime()) / 1000
    if (duration >= minBreakSeconds) {
      deductionSeconds += Math.min(duration, capSeconds)
    }
  }

  const netSeconds = Math.max(0, grossSeconds - deductionSeconds)
  const netMinutes = Math.round(netSeconds / 60)

  const safeInterval = roundingMinutes > 0 ? roundingMinutes : 1
  if (safeInterval === 1) return netMinutes / 60

  const remainder = netMinutes % safeInterval
  const roundedMinutes = remainder > 0 ? netMinutes - remainder + safeInterval : netMinutes
  return roundedMinutes / 60
}

// Public accessor for meal break durations, in seconds, completed breaks only.
export function mealBreakDurations(tc: TimecardLike): number[] {
  return mealBreakPairs(tc).map(([o, i]) => (i.getTime() - o.getTime()) / 1000)
}

// Duration to DISPLAY (reports/SMS), whole minutes, capped at the deduction cap.
export function displayMealBreakMinutes(durationSeconds: number, ruleset: PayrollRuleset): number {
  const minutes = Math.round(durationSeconds / 60)
  const cap = Math.round(ruleset.meal_break_deduction_cap)
  return Math.min(minutes, cap)
}

// MARK: Short Turnaround

export function isShortTurnaround(tc: TimecardLike, allTimecards: TimecardLike[], ruleset: PayrollRuleset): boolean {
  if (!ruleset.short_turn_penalty_enabled) return false
  const start = getPunchTime(tc.punches, 'start')
  if (!start || !tc.crew_member_id) return false

  const previousCards = allTimecards.filter(o => {
    if (o.crew_member_id !== tc.crew_member_id || o.id === tc.id) return false
    const end = getPunchTime(o.punches, 'end') ?? DISTANT_PAST
    return end < start
  })
  if (previousCards.length === 0) return false

  const lastCard = previousCards.reduce((a, b) => {
    const aEnd = getPunchTime(a.punches, 'end') ?? DISTANT_PAST
    const bEnd = getPunchTime(b.punches, 'end') ?? DISTANT_PAST
    return aEnd < bEnd ? b : a
  })
  const lastEnd = getPunchTime(lastCard.punches, 'end')
  if (!lastEnd) return false

  const restSeconds = (start.getTime() - lastEnd.getTime()) / 1000
  return restSeconds < ruleset.short_turn_rest_hours * 3600
}

// MARK: Worked Hours (raw, recordkeeping only — NOT used for pay)

export function straightTimeHours(tc: TimecardLike, allTimecards: TimecardLike[], ruleset: PayrollRuleset, roundingMinutes = 1): number {
  if (tc.is_travel_day) return 0
  if (!getPunchTime(tc.punches, 'start') || !getPunchTime(tc.punches, 'end')) return 0
  if (isShortTurnaround(tc, allTimecards, ruleset)) return 0
  const net = calculateNetHours(tc, ruleset, roundingMinutes)
  return Math.min(net, ruleset.overtime_after_hours)
}

export function overtimeHours(tc: TimecardLike, allTimecards: TimecardLike[], ruleset: PayrollRuleset, roundingMinutes = 1): number {
  if (tc.is_travel_day) return 0
  if (!getPunchTime(tc.punches, 'start') || !getPunchTime(tc.punches, 'end')) return 0
  if (isShortTurnaround(tc, allTimecards, ruleset)) return 0
  const net = calculateNetHours(tc, ruleset, roundingMinutes)
  const otHours = net - ruleset.overtime_after_hours
  if (otHours <= 0) return 0
  if (ruleset.double_time_enabled) {
    return Math.min(otHours, ruleset.double_time_after_hours - ruleset.overtime_after_hours)
  }
  return otHours
}

export function doubleTimeHours(tc: TimecardLike, allTimecards: TimecardLike[], ruleset: PayrollRuleset, roundingMinutes = 1): number {
  if (tc.is_travel_day) return 0
  if (!getPunchTime(tc.punches, 'start') || !getPunchTime(tc.punches, 'end')) return 0
  const net = calculateNetHours(tc, ruleset, roundingMinutes)
  if (isShortTurnaround(tc, allTimecards, ruleset)) return net
  if (!ruleset.double_time_enabled) return 0
  return Math.max(0, net - ruleset.double_time_after_hours)
}

// MARK: Paid Hours (1.3 — ceiling rounded, drives all pay)

export function paidNetHours(tc: TimecardLike, ruleset: PayrollRuleset, roundingMinutes = 1): number {
  if (tc.is_travel_day) return 0
  if (!getPunchTime(tc.punches, 'start') || !getPunchTime(tc.punches, 'end')) return 0
  return Math.ceil(calculateNetHours(tc, ruleset, roundingMinutes))
}

export function paidStraightTimeHours(tc: TimecardLike, allTimecards: TimecardLike[], ruleset: PayrollRuleset, roundingMinutes = 1): number {
  if (tc.is_travel_day) return 0
  if (!getPunchTime(tc.punches, 'start') || !getPunchTime(tc.punches, 'end')) return 0
  if (isShortTurnaround(tc, allTimecards, ruleset)) return 0
  const paidNet = paidNetHours(tc, ruleset, roundingMinutes)
  return Math.min(paidNet, ruleset.overtime_after_hours)
}

export function paidOvertimeHours(tc: TimecardLike, allTimecards: TimecardLike[], ruleset: PayrollRuleset, roundingMinutes = 1): number {
  if (tc.is_travel_day) return 0
  if (!getPunchTime(tc.punches, 'start') || !getPunchTime(tc.punches, 'end')) return 0
  if (isShortTurnaround(tc, allTimecards, ruleset)) return 0
  const paidNet = paidNetHours(tc, ruleset, roundingMinutes)
  const otHours = paidNet - ruleset.overtime_after_hours
  if (otHours <= 0) return 0
  if (ruleset.double_time_enabled) {
    return Math.min(otHours, ruleset.double_time_after_hours - ruleset.overtime_after_hours)
  }
  return otHours
}

export function paidDoubleTimeHours(tc: TimecardLike, allTimecards: TimecardLike[], ruleset: PayrollRuleset, roundingMinutes = 1): number {
  if (tc.is_travel_day) return 0
  if (!getPunchTime(tc.punches, 'start') || !getPunchTime(tc.punches, 'end')) return 0
  const paidNet = paidNetHours(tc, ruleset, roundingMinutes)
  if (isShortTurnaround(tc, allTimecards, ruleset)) return paidNet
  if (!ruleset.double_time_enabled) return 0
  return Math.max(0, paidNet - ruleset.double_time_after_hours)
}

// MARK: Meal Penalties

export function mealPenaltyCount(tc: TimecardLike, ruleset: PayrollRuleset): number {
  if (tc.is_travel_day) return 0
  if (!ruleset.meal_penalty_enabled) return 0
  const start = getPunchTime(tc.punches, 'start')
  if (!start) return 0

  const graceSeconds = ruleset.meal_penalty_grace_period * 3600
  let penalties = 0

  const m1Out = getPunchTime(tc.punches, 'meal_out')
  const end = getPunchTime(tc.punches, 'end')

  if (m1Out) {
    if ((m1Out.getTime() - start.getTime()) / 1000 > graceSeconds) penalties += 1
  } else if (end) {
    if ((end.getTime() - start.getTime()) / 1000 > graceSeconds) penalties += 1
  }

  const m1In = getPunchTime(tc.punches, 'meal_in')
  if (m1In) {
    const m2Out = getPunchTime(tc.punches, 'meal2_out')
    if (m2Out) {
      if ((m2Out.getTime() - m1In.getTime()) / 1000 > graceSeconds) penalties += 1
    } else if (end) {
      if ((end.getTime() - m1In.getTime()) / 1000 > graceSeconds) penalties += 1
    }
  }

  return penalties
}

export function mealPenaltyTotal(tc: TimecardLike, ruleset: PayrollRuleset): number {
  const count = mealPenaltyCount(tc, ruleset)
  if (count === 0) return 0
  const stThreshold = ruleset.overtime_after_hours > 0 ? ruleset.overtime_after_hours : 10
  const hourlyRate = tc.day_rate / stThreshold
  const otRate = hourlyRate * 1.5
  const penaltyRate = ruleset.meal_penalty_amount > 0 ? ruleset.meal_penalty_amount : otRate
  return count * penaltyRate
}

// MARK: Hybrid Travel Pay

// Additive travel pay for a work day that ALSO includes a travel leg.
// Returns 0 on pure travel days (is_travel_day) — those are paid entirely
// through totalPay's travel branch instead.
export function travelLegPay(tc: TimecardLike, ruleset: PayrollRuleset): number {
  if (tc.is_travel_day) return 0
  if (!tc.travel_in_day && !tc.travel_out_day) return 0
  const legAmount = ruleset.travel_rate === 'fullDay' ? tc.day_rate : tc.day_rate / 2
  const legs = (tc.travel_in_day ? 1 : 0) + (tc.travel_out_day ? 1 : 0)
  return legs * legAmount
}

// MARK: Total Pay

export function totalPay(tc: TimecardLike, allTimecards: TimecardLike[], ruleset: PayrollRuleset, roundingMinutes = 1): number {
  // Pure travel day (no work)
  if (tc.is_travel_day) {
    return ruleset.travel_rate === 'fullDay' ? tc.day_rate : tc.day_rate / 2
  }

  // No punches
  if (!getPunchTime(tc.punches, 'start') || !getPunchTime(tc.punches, 'end')) return 0

  const stThreshold = ruleset.overtime_after_hours > 0 ? ruleset.overtime_after_hours : 10
  const hourlyRate = tc.day_rate / stThreshold
  const otRate = hourlyRate * 1.5
  const dtRate = hourlyRate * 2

  const isSTA = isShortTurnaround(tc, allTimecards, ruleset)
  const travelPay = travelLegPay(tc, ruleset)

  if (isSTA) {
    const paidNet = paidNetHours(tc, ruleset, roundingMinutes)
    const guaranteeHours = stThreshold
    const actualDTHours = Math.max(paidNet, guaranteeHours)
    const basePay = actualDTHours * dtRate
    return basePay + mealPenaltyTotal(tc, ruleset) + travelPay
  }

  const st = paidStraightTimeHours(tc, allTimecards, ruleset, roundingMinutes)
  const ot = paidOvertimeHours(tc, allTimecards, ruleset, roundingMinutes)
  const dt = paidDoubleTimeHours(tc, allTimecards, ruleset, roundingMinutes)
  const netHours = calculateNetHours(tc, ruleset, roundingMinutes)

  const workedAnyHours = st > 0 || ot > 0 || dt > 0
  let dayBase: number
  if (!workedAnyHours) {
    dayBase = 0
  } else if (tc.pay_as_half_day && netHours <= 5) {
    dayBase = tc.day_rate / 2
  } else {
    dayBase = tc.day_rate
  }

  const total = dayBase + ot * otRate + dt * dtRate
  return total + mealPenaltyTotal(tc, ruleset) + travelPay
}
