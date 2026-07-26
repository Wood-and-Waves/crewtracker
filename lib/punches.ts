export const PUNCH_ORDER = [
  'start',
  'meal_out', 'meal_in',
  'meal2_out', 'meal2_in',
  'meal3_out', 'meal3_in',
  'end',
] as const
export type PunchType = typeof PUNCH_ORDER[number]

export const PUNCH_LABELS: Record<PunchType, string> = {
  start: 'Start',
  meal_out: 'M1 Out',
  meal_in: 'M1 In',
  meal2_out: 'M2 Out',
  meal2_in: 'M2 In',
  meal3_out: 'M3 Out',
  meal3_in: 'M3 In',
  end: 'Wrap',
}

/**
 * Meal breaks in order, as [out, in] pairs.
 *
 * The single place that knows how many meals exist. Payroll deduction, meal
 * penalties, the tracker columns, the CSV, the PDF and the crew timesheet all
 * derive from this — adding a fourth meal should mean adding a row here and to
 * PUNCH_ORDER/PUNCH_LABELS, and nothing else.
 */
export const MEAL_PAIRS: readonly (readonly [PunchType, PunchType])[] = [
  ['meal_out', 'meal_in'],
  ['meal2_out', 'meal2_in'],
  ['meal3_out', 'meal3_in'],
] as const

/** Short label for a meal break by index: 0 -> "M1". */
export const mealLabel = (index: number) => `M${index + 1}`

/**
 * The punch columns to render when `mealCount` meals are visible.
 * Start, then that many meal pairs, then Wrap.
 */
export function visiblePunchTypes(mealCount: number): PunchType[] {
  const meals = MEAL_PAIRS.slice(0, Math.max(1, Math.min(mealCount, MEAL_PAIRS.length)))
  return ['start', ...meals.flatMap(pair => [...pair]), 'end']
}

/**
 * How many meal breaks to SHOW for a set of timecards.
 *
 * A third meal is rare, so the columns for one shouldn't sit empty on every
 * show. A meal is revealed once the previous one has been taken — the count is
 * computed across a whole room rather than per person, because the tracker is a
 * ruled grid: per-person visibility would give each row a different number of
 * columns and the table would stop lining up.
 *
 * Always at least one meal, so there's somewhere to punch the first break.
 */
export function visibleMealCount(punchSets: Punch[][]): number {
  let visible = 1
  for (let i = 0; i < MEAL_PAIRS.length - 1; i++) {
    const [outType] = MEAL_PAIRS[i]
    // Reveal the next meal once anyone has started this one.
    const anyStartedThis = punchSets.some(ps => ps.some(p => p.punch_type === outType))
    if (anyStartedThis) visible = i + 2
  }
  return Math.min(visible, MEAL_PAIRS.length)
}

export type Punch = { id: string; punch_type: PunchType; punched_at: string }

export function nextPunchType(punches: Punch[]): PunchType | null {
  const done = new Set(punches.map(p => p.punch_type))
  for (const type of PUNCH_ORDER) {
    if (!done.has(type)) return type
  }
  return null
}

export function isWrapped(punches: Punch[]): boolean {
  return punches.some(p => p.punch_type === 'end')
}

export function formatPunchTime(iso: string, timezone: string, use24Hour: boolean = false): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    hour12: !use24Hour,
  })
}

function getPunch(punches: Punch[], type: PunchType): Date | null {
  const p = punches.find(p => p.punch_type === type)
  return p ? new Date(p.punched_at) : null
}

/**
 * Validates a proposed punch time against the other punches on this timecard.
 *
 * Derived from PUNCH_ORDER rather than written out per type. The old version
 * was a switch listing the specific neighbours to compare against, which had to
 * grow for every new meal and quietly missed cases: `meal_in`, for instance,
 * only checked M1 Out and M2 Out, so an M1 In set before Start passed whenever
 * M1 Out happened to be missing. Comparing against *every* punch on either side
 * closes those gaps and needs no changes when a meal is added.
 *
 * Walks outward from the punch's own position so the message names the nearest
 * conflict, which is the one a PM can act on.
 */
export function getChronologyError(time: Date, type: PunchType, punches: Punch[]): string | null {
  const idx = PUNCH_ORDER.indexOf(type)

  for (let i = idx - 1; i >= 0; i--) {
    const earlier = getPunch(punches, PUNCH_ORDER[i])
    if (earlier && time <= earlier) {
      return `${PUNCH_LABELS[type]} must be after ${PUNCH_LABELS[PUNCH_ORDER[i]]}.`
    }
  }

  for (let i = idx + 1; i < PUNCH_ORDER.length; i++) {
    const later = getPunch(punches, PUNCH_ORDER[i])
    if (later && time >= later) {
      return `${PUNCH_LABELS[type]} must be before ${PUNCH_LABELS[PUNCH_ORDER[i]]}.`
    }
  }

  return null
}

// ============================================================
// Batch action logic — port of iOS TrackerConsoleView batch rules.
// Pure, side-effect-free helpers. Eligibility is derived purely from
// which punch timestamps exist on a timecard (not how they were set),
// so individual and batch punches share identical state semantics.
// ============================================================

// Minimal shape the batch helpers need from a timecard.
export type BatchTimecard = {
  id: string
  crew_member_name: string
  role: string
  is_travel_day: boolean
  punches: Punch[]
}

function has(punches: Punch[], type: PunchType): boolean {
  return punches.some(p => p.punch_type === type)
}

// Should this crew member RECEIVE a batch punch of `type`? Requires the prior
// punch in the sequence to exist, this punch to be absent, and (for meal
// punches) the day not yet wrapped. Travel-day crew are never eligible.
//
// Derived from PUNCH_ORDER, so a new meal needs no case added here.
export function isEligibleForBatch(punches: Punch[], isTravelDay: boolean, type: PunchType): boolean {
  if (isTravelDay) return false
  if (has(punches, type)) return false          // already punched
  if (type === 'start') return true
  if (type === 'end') return has(punches, 'start')
  // Meal punches: the previous punch must exist and the day must be open.
  if (has(punches, 'end')) return false
  const previous = PUNCH_ORDER[PUNCH_ORDER.indexOf(type) - 1]
  return has(punches, previous)
}

// A batch button is "active" (highlighted) if at least one crew member in
// scope is eligible. Multiple buttons can be active at once.
export function canApplyBatch(timecards: BatchTimecard[], type: PunchType): boolean {
  return timecards.some(tc => isEligibleForBatch(tc.punches, tc.is_travel_day, type))
}

// Human-readable reason a crew member was skipped, for the post-action
// summary. Only meaningful for crew who did NOT receive the punch.
export function ineligibilityReason(punches: Punch[], isTravelDay: boolean, type: PunchType): string {
  if (isTravelDay) return 'Travel Day'

  if (type === 'start') {
    return has(punches, 'start') ? 'Already Started' : 'Excluded'
  }
  if (type === 'end') {
    if (!has(punches, 'start')) return 'Not Started Yet'
    if (has(punches, 'end')) return 'Already Wrapped'
    return 'Excluded'
  }

  // Meal punches, in the order the checks should fire.
  const previous = PUNCH_ORDER[PUNCH_ORDER.indexOf(type) - 1]
  if (!has(punches, previous)) {
    return previous === 'start' ? 'Not Started Yet' : `${PUNCH_LABELS[previous]} Not Set`
  }
  if (has(punches, 'end')) return 'Already Wrapped'
  if (has(punches, type)) return 'Already Punched'
  return 'Excluded'
}

export type BatchPlan = {
  applied: { id: string; name: string }[]
  skipped: { name: string; reason: string }[]
}

// Given the PM's checked set and chosen time, decide who actually gets the
// punch. Checked crew whose chosen time would fall out of order (per the
// same chronology rules as individual entry) are skipped as "Time conflict".
// Unchecked crew are skipped with their ineligibility reason, or "Excluded"
// if the PM manually unchecked an otherwise-eligible person.
export function planBatchApply(
  scope: BatchTimecard[],
  type: PunchType,
  when: Date,
  checkedIds: Set<string>,
): BatchPlan {
  const applied: { id: string; name: string }[] = []
  const skipped: { name: string; reason: string }[] = []

  for (const tc of scope) {
    if (checkedIds.has(tc.id)) {
      const others = tc.punches.filter(p => p.punch_type !== type)
      const err = getChronologyError(when, type, others)
      if (err) {
        skipped.push({ name: tc.crew_member_name, reason: 'Time conflict' })
      } else {
        applied.push({ id: tc.id, name: tc.crew_member_name })
      }
    } else {
      const reason = isEligibleForBatch(tc.punches, tc.is_travel_day, type)
        ? 'Excluded'
        : ineligibilityReason(tc.punches, tc.is_travel_day, type)
      skipped.push({ name: tc.crew_member_name, reason })
    }
  }

  return { applied, skipped }
}
