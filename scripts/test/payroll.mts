// Payroll regression tests — pure arithmetic, no database.
//
//   npm run test:payroll
//
// WHY
// ---
// lib/payroll.ts is a line-by-line port of the Swift PayrollCalculator and
// decides what people actually get paid. It has been verified by hand several
// times — against the Swift source, and against a real client payroll
// spreadsheet — but never encoded, so every change meant re-deriving the same
// numbers by hand and hoping nothing else moved.
//
// These are the cases that have historically been got wrong or that carry the
// most money. Each one states the arithmetic in the name so a failure says what
// broke, not just that something did.

import {
  calculateNetHours, straightTimeHours, overtimeHours, doubleTimeHours,
  paidNetHours, paidOvertimeHours, mealPenaltyCount, mealPenaltyTotal,
  travelLegPay, totalPay, isShortTurnaround, displayMealBreakMinutes,
  type PayrollRuleset, type TimecardLike,
} from '../../lib/payroll.ts'

let pass = 0, fail = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : actual === expected
  ok ? (pass++, console.log(`  ✓ ${name}`))
     : (fail++, console.log(`  ✗ ${name}\n      expected ${expected}, got ${actual}`))
}

const RULES: PayrollRuleset = {
  overtime_after_hours: 10,
  double_time_enabled: true,
  double_time_after_hours: 12,
  travel_rate: 'halfDay',
  meal_penalty_enabled: true,
  meal_penalty_grace_period: 6,
  meal_penalty_amount: 0,          // 0 => hourly * 1.5
  continuous_time_enabled: false,
  minimum_meal_break_enabled: true,
  minimum_meal_break_minutes: 30,
  meal_break_deduction_cap: 60,
  short_turn_penalty_enabled: true,
  short_turn_rest_hours: 10,
}

const D = '2026-08-01'
const at = (hhmm: string, day = D) => `${day}T${hhmm}:00.000Z`
let seq = 0
function card(punches: [string, string][], over: Partial<TimecardLike> = {}): TimecardLike {
  return {
    id: `tc-${++seq}`, crew_member_id: 'crew-1', day_rate: 500,
    is_travel_day: false, travel_in_day: false, travel_out_day: false, pay_as_half_day: false,
    punches: punches.map(([punch_type, t]) => ({ punch_type, punched_at: t })),
    ...over,
  }
}

console.log('=== net hours ===')
check('8:00–18:00 with no break = 10h',
  calculateNetHours(card([['start', at('08:00')], ['end', at('18:00')]]), RULES), 10)
check('8:00–18:00 with a 60-min break = 9h',
  calculateNetHours(card([['start', at('08:00')], ['meal_out', at('12:00')], ['meal_in', at('13:00')], ['end', at('18:00')]]), RULES), 9)
// Under the minimum, the whole break is paid — this is the gate, not a partial deduction.
check('a 20-min break is under the 30-min minimum, so nothing is deducted',
  calculateNetHours(card([['start', at('08:00')], ['meal_out', at('12:00')], ['meal_in', at('12:20')], ['end', at('18:00')]]), RULES), 10)
// Over the cap, only the cap comes off.
check('a 90-min break deducts only the 60-min cap',
  calculateNetHours(card([['start', at('08:00')], ['meal_out', at('12:00')], ['meal_in', at('13:30')], ['end', at('18:00')]]), RULES), 9)
check('continuous time pays wrap-minus-start with no deduction at all',
  calculateNetHours(
    card([['start', at('08:00')], ['meal_out', at('12:00')], ['meal_in', at('13:00')], ['end', at('18:00')]]),
    { ...RULES, continuous_time_enabled: true, minimum_meal_break_enabled: false }), 10)
check('a third meal deducts on the same terms as the first two',
  calculateNetHours(card([
    ['start', at('06:00')], ['meal_out', at('10:00')], ['meal_in', at('11:00')],
    ['meal2_out', at('15:00')], ['meal2_in', at('16:00')],
    ['meal3_out', at('20:00')], ['meal3_in', at('21:00')], ['end', at('23:00')],
  ]), RULES), 14)

console.log('\n=== overtime and double time ===')
const long = card([['start', at('06:00')], ['end', at('19:00')]])   // 13h straight
check('13h day: 10h straight time', straightTimeHours(long, [long], RULES), 10)
check('13h day: 2h overtime (10→12)', overtimeHours(long, [long], RULES), 2)
check('13h day: 1h double time (past 12)', doubleTimeHours(long, [long], RULES), 1)
const noDt = card([['start', at('06:00')], ['end', at('19:00')]])
check('with double time disabled, everything past 10h is overtime',
  overtimeHours(noDt, [noDt], { ...RULES, double_time_enabled: false }), 3)

console.log('\n=== paid vs worked (the billing rule) ===')
// Each DAY is ceiling-rounded before summing, so two quarter-hours of overtime
// on separate days bill as two hours, not half an hour. Verified against a real
// client spreadsheet.
const q1 = card([['start', at('08:00')], ['end', at('18:15')]])
const q2 = card([['start', at('08:00', '2026-08-02')], ['end', at('18:15', '2026-08-02')]], { crew_member_id: 'crew-2' })
check('10.25h worked rounds up to 11h paid', paidNetHours(q1, RULES), 11)
check('0.25h overtime bills as a full hour', paidOvertimeHours(q1, [q1], RULES), 1)
check('and again on the next day — 2 paid hours from 0.5h worked',
  paidOvertimeHours(q1, [q1], RULES) + paidOvertimeHours(q2, [q2], RULES), 2)

console.log('\n=== meal penalties ===')
check('a break inside the 6h grace period earns no penalty',
  mealPenaltyCount(card([['start', at('08:00')], ['meal_out', at('13:00')], ['meal_in', at('13:30')], ['end', at('18:00')]]), RULES), 0)
check('no break at all in a 10h day earns one penalty',
  mealPenaltyCount(card([['start', at('08:00')], ['end', at('18:00')]]), RULES), 1)
check('penalties cap at 3 per day',
  mealPenaltyCount(card([['start', at('00:00')], ['end', at('23:59')]]), RULES) <= 3, true)
check('penalty rate defaults to hourly × 1.5 when no amount is set',
  mealPenaltyTotal(card([['start', at('08:00')], ['end', at('18:00')]]), RULES), (500 / 10) * 1.5)
check('an explicit penalty amount overrides the hourly calculation',
  mealPenaltyTotal(card([['start', at('08:00')], ['end', at('18:00')]]), { ...RULES, meal_penalty_amount: 40 }), 40)

console.log('\n=== travel ===')
// travelLegPay is deliberately LEG pay only — it returns 0 for a pure travel
// day, which totalPay pays instead. Both are asserted so the split stays put.
check('travelLegPay pays nothing for a pure travel day (totalPay handles it)',
  travelLegPay(card([], { is_travel_day: true }), RULES), 0)
check('a pure travel day at half rate pays half the day rate',
  totalPay(card([], { is_travel_day: true }), [], RULES), 250)
check('travel in AND out is two legs',
  travelLegPay(card([['start', at('08:00')], ['end', at('18:00')]], { travel_in_day: true, travel_out_day: true }), RULES), 500)
check('travel pay is additive on top of a worked day (break taken, so no penalty)',
  totalPay(card([['start', at('08:00')], ['meal_out', at('12:00')], ['meal_in', at('13:00')], ['end', at('18:00')]],
    { travel_in_day: true }), [], RULES), 750)

console.log('\n=== day-rate guarantee ===')
check('a 4h day still pays the full day rate',
  totalPay(card([['start', at('08:00')], ['end', at('12:00')]]), [], RULES), 500)
check('pay as half day halves the guarantee',
  totalPay(card([['start', at('08:00')], ['end', at('12:00')]], { pay_as_half_day: true }), [], RULES), 250)
check('a 10h day with a break is exactly the day rate — no overtime yet',
  totalPay(card([['start', at('08:00')], ['meal_out', at('12:30')], ['meal_in', at('13:30')], ['end', at('19:00')]]), [], RULES), 500)
// Worth pinning explicitly: the penalty is part of total pay, not a separate
// figure a report has to remember to add. A no-break 10h day is day rate + 75.
check('a no-break 10h day is day rate PLUS the meal penalty',
  totalPay(card([['start', at('08:00')], ['end', at('18:00')]]), [], RULES), 500 + 75)

console.log('\n=== short turnaround ===')
const day1 = card([['start', at('08:00', '2026-08-01')], ['end', at('23:00', '2026-08-01')]])
const day2 = card([['start', at('06:00', '2026-08-02')], ['end', at('16:00', '2026-08-02')]])
check('7h rest is under the 10h threshold', isShortTurnaround(day2, [day1, day2], RULES), true)
const restedA = card([['start', at('08:00', '2026-08-01')], ['end', at('18:00', '2026-08-01')]])
const restedB = card([['start', at('08:00', '2026-08-02')], ['end', at('18:00', '2026-08-02')]])
check('14h rest is not a short turnaround', isShortTurnaround(restedB, [restedA, restedB], RULES), false)
check('a short turnaround pays every hour at double time',
  doubleTimeHours(day2, [day1, day2], RULES), 10)
check('but never below the day-rate guarantee',
  totalPay(day2, [day1, day2], RULES) >= 500, true)
// The tracker (shows/[id]/page.tsx) fetches earlier days as END punches ONLY —
// that is all this rule reads from a previous card. Pinned so a future "tidy"
// that also filters on start, or on the room, cannot silently switch the rule
// off. The previous card is in a different room on purpose: rest is per
// person, not per room.
const wrapOnly = card([['end', at('23:00', '2026-08-01')]], { room_id: 'room-other' } as any)
check('a previous-day card carrying only its wrap, in another room, still trips the rule',
  isShortTurnaround(day2, [wrapOnly, day2], RULES), true)
check('and a previous-day card with NO wrap does not',
  isShortTurnaround(day2, [card([['start', at('08:00', '2026-08-01')]]), day2], RULES), false)

console.log('\n=== no-show and cancelled days (0027) ===')
// Booked, did not work. Both are zero hours; only the pay differs, and only
// for a cancellation, by the show's own percentage.
const noShow = card([], { absence: 'no_show' })
const cancelled = card([], { absence: 'cancelled' })
check('a no-show pays nothing', totalPay(noShow, [noShow], RULES), 0)
check('a cancelled day pays nothing when the show sets no cancellation pay', totalPay(cancelled, [cancelled], RULES), 0)
check('a cancelled day pays the show\'s percentage of the day rate',
  totalPay(cancelled, [cancelled], { ...RULES, cancellation_pay_percent: 50 }), 250)
check('at 100% it pays the whole day rate',
  totalPay(cancelled, [cancelled], { ...RULES, cancellation_pay_percent: 100 }), 500)
check('an absent day has no hours',
  straightTimeHours(cancelled, [cancelled], RULES) + overtimeHours(cancelled, [cancelled], RULES) + doubleTimeHours(cancelled, [cancelled], RULES), 0)
// A stray punch on an absent card must never make it "the previous day" —
// nobody worked, so there is no rest to measure from.
const absentWithStrayWrap = card([['end', at('23:00', '2026-08-01')]], { absence: 'cancelled' })
check('an absent previous day never triggers short turnaround',
  isShortTurnaround(day2, [absentWithStrayWrap, day2], RULES), false)
check('and an absent day itself is never a short turnaround',
  isShortTurnaround(card([['start', at('06:00', '2026-08-02')]], { absence: 'no_show' }), [day1], RULES), false)
check('absence beats travel: a cancelled travel day pays cancellation pay, not travel pay',
  totalPay(card([], { absence: 'cancelled', is_travel_day: true }), [], { ...RULES, cancellation_pay_percent: 0 }), 0)

console.log('\n=== break display ===')
check('a 90-min break displays as the 60-min cap', displayMealBreakMinutes(90 * 60, RULES), 60)
check('a 20-min break displays in full (under the minimum, nothing deducted)',
  displayMealBreakMinutes(20 * 60, RULES), 20)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
