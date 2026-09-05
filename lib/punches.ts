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
 * Meals always shown, whether or not anyone has taken them. Two is the layout
 * every PM already knows, so an ordinary day looks exactly as it always has and
 * the columns don't shuffle around as people punch in.
 */
const ALWAYS_VISIBLE_MEALS = 2

/**
 * Which punch columns to show, given every timecard in scope.
 *
 * Beyond the first two meals, columns appear ONE at a time and only once
 * they're actually reachable: a third meal's Out shows after someone returns
 * from their second, and its In shows only after that Out is punched. A third
 * break is rare, so its columns shouldn't sit empty on every show — but a day
 * that never takes one looks completely unchanged.
 *
 * Scope is a whole DAY, not a room: the tracker shows rooms side by side, and
 * computing this per room made one room narrow and its neighbour wide. Rooms
 * on the same day now always share a column set, so they're always the same
 * width.
 */
export function visiblePunchTypes(punchSets: Punch[][]): PunchType[] {
  const anyHas = (t: PunchType) => punchSets.some(ps => ps.some(p => p.punch_type === t))
  const types: PunchType[] = ['start']

  for (let i = 0; i < MEAL_PAIRS.length; i++) {
    const [outType, inType] = MEAL_PAIRS[i]
    if (i < ALWAYS_VISIBLE_MEALS) {
      types.push(outType, inType)
      continue
    }
    // Reachable only once the previous meal is finished.
    if (!anyHas(MEAL_PAIRS[i - 1][1])) break
    types.push(outType)
    if (!anyHas(outType)) break
    types.push(inType)
  }

  types.push('end')
  return types
}

export type Punch = {
  id: string
  punch_type: PunchType
  punched_at: string
  /**
   * Who authored this punch: 'staff' (a signed-in PM) or 'crew' (a no-login
   * clock link). Optional because most callers neither select nor need it.
   *
   * ATTRIBUTION ONLY. lib/payroll.ts must never read this — a crew-entered
   * hour is worth exactly what a PM-entered hour is worth, and the moment the
   * calculator can tell them apart somebody will make it pay them differently.
   * The tracker marks it and the Final Report counts it; nothing else.
   */
  source?: 'staff' | 'crew'
}

/**
 * Snap a wall-clock time to the organization's punch grid.
 *
 * WALL CLOCK, NOT THE INSTANT. Rounding the epoch millisecond looks equivalent
 * and is not: a zone offset by :45 (Kathmandu) or :30 (Adelaide) would land on
 * a clean quarter-hour in UTC and an ugly one on the wall the crew member is
 * reading. The grid people care about is the one on the clock.
 *
 * ALWAYS UP to the next interval, never nearest — Dan's call, 2026-09-04, and
 * it matches what calculateNetHours already does to a day's net minutes, so
 * the app rounds one direction everywhere. A time already ON the grid does not
 * move; only a non-zero remainder pushes to the next mark, which is the same
 * `remainder > 0` shape calculateNetHours uses.
 *
 * Note this is not uniformly in the crew member's favour: rounding a START up
 * moves it later and costs them the difference, while rounding a WRAP up pays
 * them to the next mark. That is inherent in "always up" and is a policy
 * choice, not an oversight.
 *
 * NOTE this is a DIFFERENT operation from the roundingMinutes that
 * calculateNetHours applies. That one ceilings the total NET MINUTES of a
 * finished day; this one moves the punch itself. They read from the same org
 * setting but they are not interchangeable, and applying both to the same
 * timecard is not double-counting — the first decides the times, the second
 * decides how the resulting duration is billed.
 *
 * Returns dayOffset because anything after 23:45 at a 15-minute grid rounds up
 * to 24:00, which is 00:00 the next day — the correct answer for an overnight
 * wrap, and one that silently becomes an invalid "24:00" if you only return
 * the string.
 */
export function roundWallTime(
  timeStr: string,
  roundingMinutes: number,
): { timeStr: string; dayOffset: number } {
  const interval = roundingMinutes > 0 ? Math.floor(roundingMinutes) : 1
  const [h, m] = timeStr.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { timeStr, dayOffset: 0 }
  if (interval <= 1) return { timeStr, dayOffset: 0 }

  const total = h * 60 + m
  const remainder = total % interval
  const snapped = remainder > 0 ? total - remainder + interval : total
  const dayOffset = Math.floor(snapped / 1440)
  const mins = snapped % 1440
  const pad = (n: number) => String(n).padStart(2, '0')
  return { timeStr: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`, dayOffset }
}

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

// May this punch be REMOVED without orphaning a later one?
//
// Deleting a punch from the middle of a day leaves the punches after it with a
// missing predecessor: clear M1 Out and M1 In is a lunch that ended without
// starting, which mealBreakPairs() would then read as a broken pair. The rule
// is the mirror of isEligibleForBatch — after the removal, every punch that
// REMAINS must still have whatever it depends on.
//
// Returns null when the clear is safe, or the reason it is not, phrased for
// whoever is about to be refused.
export function clearBlockedReason(punches: Punch[], type: PunchType): string | null {
  const remaining = punches.filter(p => p.punch_type !== type)
  for (const p of remaining) {
    // 'end' needs a start, not the meal before it; 'start' needs nothing.
    const requirement: PunchType | null =
      p.punch_type === 'start' ? null
      : p.punch_type === 'end' ? 'start'
      : PUNCH_ORDER[PUNCH_ORDER.indexOf(p.punch_type) - 1]
    if (requirement && !has(remaining, requirement)) {
      return `Clear ${PUNCH_LABELS[p.punch_type]} first — it needs ${PUNCH_LABELS[type]}.`
    }
  }
  return null
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
