import type { Activity } from '@/lib/dayActivities'

// "I travelled today", said once, by the person it happened to.
//
// Dan, 2026-09-17: "There is not a way to mark a day as travel in the crews log
// page. I have to do it as PM." True, and deliberate until now — timecard
// writes need the edit-timecards permission and crew have no door. The reason
// given was that flags change pay; but a crew member can already punch in at
// 6am and out at 11pm, which changes pay a great deal more. A travel day is the
// same kind of claim about the same day, and the PM still reviews it.
//
// THE CREW MEMBER IS NEVER ASKED WHICH KIND OF TRAVEL IT IS. There are three —
// a travel day with no work, and travel-in / travel-out, which are hybrids
// ADDED to the hours actually worked — and a single "did you travel?" button
// would silently pick one and be wrong about half the time. Dan: "I don't like
// the question being asked. Is there a simpler way? We already know types of
// days. Would that help at all?" It does: the app knows what the show is doing
// that day and where the day sits in this person's own run, which is enough to
// decide. So there is no question, only a sentence that is already true.
//
// lib/dayActivities.ts has reasoned about this since it was written — travel on
// a load-in day is the trip out, travel on a load-out day is the trip home. All
// this does is offer that reading to the person doing the travelling.

export type TravelKind = 'travel' | 'travel_in' | 'travel_out'

export type TravelOffer = {
  kind: TravelKind
  /** What the button says. First person, past tense where it has happened. */
  label: string
  /** What it means, one line, under the button. */
  detail: string
}

export type TravelDayFacts = {
  /** What the SHOW is doing that day. Not a statement about this person. */
  activities: Activity[]
  /** Is this the first day this person is staffed on the show? */
  firstOfRun: boolean
  /** Their last? A one-day run is both, and travel out wins — see below. */
  lastOfRun: boolean
}

/**
 * What to offer this person on this day, or null for nothing.
 *
 * NOT EVERY DAY GETS A BUTTON. Offering "I travelled in today" on day three of
 * a five-day run is noise, and a control that is usually wrong teaches people
 * to ignore it. Travel really happens on the days the show calls travel, and on
 * the first and last day of somebody's own run — which is exactly Dan's case
 * from 2026-09-15: the person who could not travel on the show's travel day and
 * arrives on the load-in instead.
 */
export function travelOffer(facts: TravelDayFacts): TravelOffer | null {
  const { activities, firstOfRun, lastOfRun } = facts
  const has = (a: Activity) => activities.includes(a)
  const works = has('load_in') || has('rehearsal') || has('show') || has('load_out')

  // A day the show spends travelling, with nothing else on it: the whole day is
  // the journey, and there is nothing to clock. This is the one kind that
  // REPLACES the day's work rather than adding to it.
  if (has('travel') && !works) {
    return {
      kind: 'travel',
      label: 'I travelled today',
      detail: 'A travel day — no hours to clock.',
    }
  }

  // Going home. A load-out day that also travels is the trip home, which is how
  // the day label has always read it; the last day of their own run is the same
  // thing from the person's side. Checked BEFORE the trip out, so that on a
  // one-day show — where both are true — it reads as going home, which is the
  // half somebody remembers to record.
  if (lastOfRun || (has('travel') && has('load_out') && !has('load_in'))) {
    return {
      kind: 'travel_out',
      label: 'I travel out today',
      detail: 'Added to the hours you work today.',
    }
  }

  // Coming in. Their first day, whatever the show calls it — which covers
  // somebody who could not make the show's travel day and came in on the
  // load-in instead.
  if (firstOfRun || has('travel')) {
    return {
      kind: 'travel_in',
      label: 'I travelled in today',
      detail: 'Added to the hours you work today.',
    }
  }

  return null
}

/**
 * Setting a plain travel day on a day that already has punches would throw away
 * hours somebody worked — the screen replaces the punch grid with a banner and
 * payroll stops counting the day. The hybrids are additive, so they are fine
 * alongside punches.
 *
 * Returns the refusal to show, or null if it may go ahead.
 */
export function travelBlockedReason(kind: TravelKind, punchCount: number): string | null {
  if (kind !== 'travel' || punchCount === 0) return null
  return 'You have times on this day already. Ask your PM to change it.'
}
