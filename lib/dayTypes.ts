// COMPATIBILITY SHIM. The model moved to lib/dayActivities.ts on 2026-09-07:
// a day is a SET of activities, and the label and colour are derived. These
// two readers accept EITHER the legacy slug (work_days.day_type, kept as a
// trigger-maintained mirror by migration 0032) OR an activities array, so
// callers migrate one at a time. New code imports lib/dayActivities directly.
//
// Nothing here touches pay. lib/payroll.ts must never import this file.

import { dayLabel, dayActivitiesBgClass, fromLegacy } from '@/lib/dayActivities'

function toActivities(value: string | readonly string[] | null | undefined) {
  return Array.isArray(value) ? value : fromLegacy(value as string | null | undefined)
}

/** The label to show, or null when there is nothing to say. */
export function dayTypeLabel(value: string | readonly string[] | null | undefined): string | null {
  return dayLabel(toActivities(value))
}

/** Tailwind background class, or null when unset/unknown. */
export function dayTypeBgClass(value: string | readonly string[] | null | undefined): string | null {
  return dayActivitiesBgClass(toActivities(value))
}
