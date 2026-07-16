export const PUNCH_ORDER = ['start', 'meal_out', 'meal_in', 'meal2_out', 'meal2_in', 'end'] as const
export type PunchType = typeof PUNCH_ORDER[number]

export const PUNCH_LABELS: Record<PunchType, string> = {
  start: 'Start',
  meal_out: 'M1 Out',
  meal_in: 'M1 In',
  meal2_out: 'M2 Out',
  meal2_in: 'M2 In',
  end: 'Wrap',
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

// Faithful port of iOS TimeEntrySheetView.getChronologyError(for:type:card:).
// Validates a proposed punch time against the OTHER punches already on this
// timecard, ensuring they stay in chronological order.
export function getChronologyError(time: Date, type: PunchType, punches: Punch[]): string | null {
  const start = getPunch(punches, 'start')
  const mealOut = getPunch(punches, 'meal_out')
  const mealIn = getPunch(punches, 'meal_in')
  const meal2Out = getPunch(punches, 'meal2_out')
  const meal2In = getPunch(punches, 'meal2_in')
  const end = getPunch(punches, 'end')

  switch (type) {
    case 'start':
      if (mealOut && time >= mealOut) return 'Start time must be before M1 Out.'
      if (end && time >= end) return 'Start time must be before Wrap time.'
      break
    case 'meal_out':
      if (start && time <= start) return 'M1 Out must be after Start time.'
      if (mealIn && time >= mealIn) return 'M1 Out must be before M1 In.'
      if (end && time >= end) return 'M1 Out must be before Wrap time.'
      break
    case 'meal_in':
      if (mealOut && time <= mealOut) return 'M1 In must be after M1 Out.'
      if (meal2Out && time >= meal2Out) return 'M1 In must be before M2 Out.'
      if (end && time >= end) return 'M1 In must be before Wrap time.'
      break
    case 'meal2_out':
      if (mealIn && time <= mealIn) return 'M2 Out must be after M1 In.'
      if (meal2In && time >= meal2In) return 'M2 Out must be before M2 In.'
      if (end && time >= end) return 'M2 Out must be before Wrap time.'
      break
    case 'meal2_in':
      if (meal2Out && time <= meal2Out) return 'M2 In must be after M2 Out.'
      if (end && time >= end) return 'M2 In must be before Wrap time.'
      break
    case 'end':
      if (meal2In && time <= meal2In) return 'Wrap time must be after M2 In.'
      if (meal2Out && !meal2In && time <= meal2Out) return 'Wrap time must be after M2 Out.'
      if (mealIn && !meal2Out && time <= mealIn) return 'Wrap time must be after M1 In.'
      if (start && time <= start) return 'Wrap time must be after Start time.'
      break
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

// Should this crew member RECEIVE a batch punch of `type`? Requires the
// prior punch in the sequence to exist, this punch to be absent, and (for
// meal punches) the day not yet wrapped. Travel-day crew are never eligible.
export function isEligibleForBatch(punches: Punch[], isTravelDay: boolean, type: PunchType): boolean {
  if (isTravelDay) return false
  switch (type) {
    case 'start': return !has(punches, 'start')
    case 'meal_out': return has(punches, 'start') && !has(punches, 'meal_out') && !has(punches, 'end')
    case 'meal_in': return has(punches, 'meal_out') && !has(punches, 'meal_in') && !has(punches, 'end')
    case 'meal2_out': return has(punches, 'meal_in') && !has(punches, 'meal2_out') && !has(punches, 'end')
    case 'meal2_in': return has(punches, 'meal2_out') && !has(punches, 'meal2_in') && !has(punches, 'end')
    case 'end': return has(punches, 'start') && !has(punches, 'end')
  }
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
  switch (type) {
    case 'start':
      if (has(punches, 'start')) return 'Already Started'
      break
    case 'meal_out':
      if (!has(punches, 'start')) return 'Not Started Yet'
      if (has(punches, 'end')) return 'Already Wrapped'
      if (has(punches, 'meal_out')) return 'Already Punched'
      break
    case 'meal_in':
      if (!has(punches, 'meal_out')) return 'M1 Out Not Set'
      if (has(punches, 'end')) return 'Already Wrapped'
      if (has(punches, 'meal_in')) return 'Already Punched'
      break
    case 'meal2_out':
      if (!has(punches, 'meal_in')) return 'M1 In Not Set'
      if (has(punches, 'end')) return 'Already Wrapped'
      if (has(punches, 'meal2_out')) return 'Already Punched'
      break
    case 'meal2_in':
      if (!has(punches, 'meal2_out')) return 'M2 Out Not Set'
      if (has(punches, 'end')) return 'Already Wrapped'
      if (has(punches, 'meal2_in')) return 'Already Punched'
      break
    case 'end':
      if (!has(punches, 'start')) return 'Not Started Yet'
      if (has(punches, 'end')) return 'Already Wrapped'
      break
  }
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
