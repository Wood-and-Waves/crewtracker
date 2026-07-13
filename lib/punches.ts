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

export function formatPunchTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
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
