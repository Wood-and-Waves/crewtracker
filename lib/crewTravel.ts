import type { Activity } from '@/lib/dayActivities'

// "Travel Day", said once, by the person it happened to.
//
// Dan, 2026-09-17: "There is not a way to mark a day as travel in the crews log
// page. I have to do it as PM." Timecard writes need the edit-timecards
// permission and crew had no door. The reason given was that flags change pay —
// but a crew member can already punch in at 6am and out at 11pm, which changes
// pay a great deal more. A travel day is the same kind of claim about the same
// day, and the PM still reviews it.
//
// THE CREW MEMBER IS ASKED NOTHING AND TOLD NOTHING. One button, two words.
// Dan again, having seen the first cut: "Can we just simplify and make all
// travel days able to have time as well? Also, remove the extra 'helping' words
// below the button. And just change the button to 'Travel Day' with the
// airplane."
//
// WHICH OF THE THREE COLUMNS GETS SET IS DERIVED, NEVER ASKED. There are three
// and they are not interchangeable:
//   · is_travel_day    — travelled, did not work. Paid at the travel rate.
//   · travel_in_day    — travelled AND worked. ADDED to the hours.
//   · travel_out_day   — the same, going home.
// The direction comes from the day (lib/dayActivities.ts has read travel on a
// load-out day as the trip home since it was written) and from where the day
// sits in this person's own run. Whether it is a hybrid at all comes from
// whether the day has times on it.
//
// THAT LAST PART IS LOAD-BEARING AND IS NOT A STYLE CHOICE. totalPay returns 0
// for a day with no start and end punch, and that check sits ABOVE the line
// that adds travel pay — so a day flagged travel_in_day with no times pays
// NOTHING, while the same day flagged is_travel_day pays the travel rate.
// Making every travel day a hybrid, which is the obvious way to let them all
// carry time, would quietly stop paying people for travel days they did not
// clock. Deriving it instead means a travel day can carry times without anybody
// choosing a column, and payroll never changes.

export type TravelDirection = 'in' | 'out'

export type TravelOffer = {
  /** Which way they are going. Only reaches the database when times exist. */
  direction: TravelDirection
  /** Two words. There is deliberately nothing under it. */
  label: string
}

export type TravelDayFacts = {
  /** What the SHOW is doing that day. Not a statement about this person. */
  activities: Activity[]
  /** Is this the first day this person is staffed on the show? */
  firstOfRun: boolean
  /** Their last? A one-day run is both, and going home wins. */
  lastOfRun: boolean
}

export const TRAVEL_LABEL = 'Travel Day'

/**
 * What pressing the button would mean on this day, or null for nothing.
 *
 * NOT EVERY DAY GETS ONE. Offering it on day three of a five-day run is noise,
 * and a control that is usually wrong teaches people to ignore it. Travel
 * really happens on the days the show calls travel, and on the first and last
 * day of somebody's own run — which covers the case this started from: the
 * person who could not travel on the show's travel day and arrives on the
 * load-in instead.
 */
export function travelOffer(facts: TravelDayFacts): TravelOffer | null {
  const { activities, firstOfRun, lastOfRun } = facts
  const has = (a: Activity) => activities.includes(a)

  // Going home. Checked first so that a one-day run — first and last at once —
  // reads as the trip home, which is the half somebody remembers to record.
  if (lastOfRun || (has('travel') && has('load_out') && !has('load_in'))) {
    return { direction: 'out', label: TRAVEL_LABEL }
  }
  // Coming in: their first day whatever the show calls it, or any day the show
  // itself is travelling.
  if (firstOfRun || has('travel')) {
    return { direction: 'in', label: TRAVEL_LABEL }
  }
  return null
}

/**
 * The three columns, from the direction and whether the day has times on it.
 *
 * No times — the day was the journey, so it is a travel day and paid as one.
 * Times — they travelled AND worked, so the leg is ADDED to those hours. The
 * person never sees this distinction; it follows their own punches.
 */
export function travelFlags(direction: TravelDirection, hasTimes: boolean): {
  is_travel_day: boolean
  travel_in_day: boolean
  travel_out_day: boolean
} {
  return {
    is_travel_day: !hasTimes,
    travel_in_day: hasTimes && direction === 'in',
    travel_out_day: hasTimes && direction === 'out',
  }
}

export const NO_TRAVEL = { is_travel_day: false, travel_in_day: false, travel_out_day: false }

/**
 * A day already marked as travel, whose times have just changed, moving between
 * "the day was the journey" and "travelled and worked".
 *
 * Returns the flags to write, or null when nothing needs to change. This is
 * what lets a travel day carry time at all: without it, adding the first punch
 * to a travel day would leave it paid at the travel rate with the hours
 * ignored, and clearing the last one would leave a hybrid that pays nothing.
 */
export function travelFlagsAfterTimeChange(
  current: { is_travel_day: boolean; travel_in_day: boolean; travel_out_day: boolean },
  hasTimes: boolean,
): { is_travel_day: boolean; travel_in_day: boolean; travel_out_day: boolean } | null {
  const marked = current.is_travel_day || current.travel_in_day || current.travel_out_day
  if (!marked) return null
  // The direction is already recorded unless this was a plain travel day, in
  // which case they are arriving somewhere to work — the trip out.
  const direction: TravelDirection = current.travel_out_day ? 'out' : 'in'
  const next = travelFlags(direction, hasTimes)
  const same = next.is_travel_day === current.is_travel_day
    && next.travel_in_day === current.travel_in_day
    && next.travel_out_day === current.travel_out_day
  return same ? null : next
}
