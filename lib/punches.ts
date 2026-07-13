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
