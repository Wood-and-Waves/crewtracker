// The words the app uses when a show stops being a hold and becomes a booking.
//
// TWO CONTROLS, ONE SET OF WORDS. The Scheduling strip's chip and Edit Show's
// toggle both flip the same flag through the same route, so they must ask the
// same question — a second copy would be a second thing for Dan to edit and a
// second chance for them to drift. Same reasoning as describeDayLines being the
// single builder behind the booking email, the text and the /book page.
//
// COPY IS DAN'S. These strings are placeholders until he has read them; the
// standing rule from the 2026-09-09 copy pass is that every user-facing string
// goes past him first.

/**
 * Who could not be emailed, as a sentence worth reading.
 *
 * Somebody with no address on file is told by NOBODY, and the person who just
 * pressed the button is the only one in a position to ring them — so this is
 * said out loud rather than logged. Empty string when everything went out,
 * which is the ordinary case.
 */
export function describeUnreached(noEmail: string[]): string {
  if (noEmail.length === 0) return ''
  const names = noEmail.length <= 3
    ? noEmail.join(', ')
    : `${noEmail.slice(0, 2).join(', ')} and ${noEmail.length - 2} others`
  // Just the fact. "Tell them yourself" was an instruction nobody needs
  // (Dan, 2026-10-01) — somebody reading that a person has no address can
  // work out the rest.
  return `No email on file for ${names}.`
}

/**
 * Asked before turning the job from a hold into a booking.
 *
 * IT SAYS NOBODY IS EMAILED, and that is the point (Dan, 2026-09-30: sending
 * automatically on this press "feels too risky"). Somebody pressing a toggle to
 * see what it does must be able to read, before they press it, that it reaches
 * no one. Telling the crew is NOTIFY_CREW_PROMPT, a separate button.
 */
export const CONFIRM_SHOW_PROMPT =
  'Mark as confirmed\n\n' +
  'This marks the show as confirmed. Telling the crew is a separate button.'

/**
 * Asked before the second press, the one that actually writes to people.
 *
 * It names the group and the exclusion, because "the crew" is vaguer than what
 * happens: somebody nobody has asked has no hold to upgrade and is left alone.
 */
export const NOTIFY_CREW_PROMPT =
  'Email the crew to say this show is confirmed?\n\n' +
  'It goes to everyone who has been asked or has accepted. ' +
  'Anyone nobody has asked yet is left alone.'

/** The same question when they have already been told once. */
export const NOTIFY_CREW_AGAIN_PROMPT =
  'Email the crew again?\n\n' +
  'Everyone who has been asked or has accepted gets another copy, ' +
  'including the people who were told the first time.'

/** The button, and what it says once the crew have been told. */
export function describeCrewTold(sentAt: string | null): string {
  if (!sentAt) return ''
  const when = new Date(sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Crew told ${when}`
}

/** Asked before putting a confirmed show back to a hold.
 *  It says nobody is emailed because nobody is — see the route. */
export const UNCONFIRM_SHOW_PROMPT =
  'Put this show back to holding the dates?\n\n' +
  'Nobody is emailed. If people have already been told it is confirmed, tell them yourself.'

/** The line under the Edit Show toggle, which states the consequence for the
 *  scheduler rather than repeating the toggle's own label. */
export function describeShowConfirmed(confirmed: boolean): string {
  return confirmed
    ? 'The client has confirmed this show, so the scheduler books crew.'
    : 'Holding the dates. The scheduler pencils crew in until this is turned on.'
}
