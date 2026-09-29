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

/** Asked before turning the job from a hold into a booking. */
export const CONFIRM_SHOW_PROMPT =
  'Mark this show as confirmed?\n\n' +
  'Everyone who has been asked or has accepted will be emailed to say it is on.'

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
