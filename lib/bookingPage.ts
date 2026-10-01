// What the public /book/[token] page says, as one decision.
//
// THE PAGE USED TO SAY THE SAME THING BEFORE AND AFTER AN ANSWER. Only the
// button area changed, so somebody who had just pressed Accept was still told
// "Northwind Staging Co. would like to book you for" — present tense, as though
// it were still asking — and somebody who had DECLINED was still being told the
// client had not confirmed the show, which had stopped being any of their
// business the moment they said no (Dan, 2026-10-01, with screenshots of both).
//
// Pure, so the five states are a table rather than three conditionals spread
// across a server component and a client one.

export type BookingAnswer = 'confirmed' | 'declined' | null

export type BookingPageCopy = {
  /** The small line above the show name. */
  lead: string
  /** Whether to say the client has not confirmed the show yet. */
  sayNotConfirmed: boolean
  /** The line under the days. Null while they are still deciding. */
  closing: string | null
}

export function describeBookingPage(input: {
  organizationName: string
  /** shows.confirmed_at is set — a booking rather than a hold. */
  showConfirmed: boolean
  /** Their answer, if they have given one. */
  response: BookingAnswer
}): BookingPageCopy {
  const { organizationName: org, showConfirmed, response } = input

  // DECLINED: the show's own state stops mattering. Whether the client has
  // confirmed it is a fact about a job they are not doing.
  if (response === 'declined') {
    return { lead: 'You declined', sayNotConfirmed: false, closing: 'Thanks for letting us know.' }
  }

  if (response === 'confirmed') {
    return {
      // What they are now ON, not what somebody would like.
      lead: showConfirmed ? 'You are booked on' : 'You are holding dates for',
      // KEPT for a hold: they agreed to hold dates, not to a booking, and that
      // is the material difference in what they just said yes to.
      sayNotConfirmed: !showConfirmed,
      // "Accepting", not "confirming" — the word on the button they pressed,
      // and the absolute from the 2026-09-09 copy pass. This line was the last
      // place in the app still saying the old one.
      closing: 'Thank you for accepting.',
    }
  }

  // Still deciding. Matches the email that sent them here: hold or book.
  return {
    lead: `${org} would like to ${showConfirmed ? 'book' : 'hold'} you for`,
    sayNotConfirmed: !showConfirmed,
    closing: null,
  }
}
