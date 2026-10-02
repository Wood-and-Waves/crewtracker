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
 * Who the notice did not reach, as a sentence worth reading.
 *
 * TWO DIFFERENT FAILURES, AND BOTH HAVE TO SHOW. Somebody with no address on
 * file is told by NOBODY, and the person who pressed the button is the only one
 * able to ring them. An email that was attempted and FAILED is worse: it looks
 * from every other angle as though they were told.
 *
 * Until 2026-10-02 only the first was rendered — the route counted failures and
 * the screens dropped them — so a part-delivered notice read as a clean one.
 * It could not surface on dev, where every run was two or three people and all
 * of them sent; it needs a real crew-sized show to appear, which is exactly when
 * it matters.
 *
 * Empty string when everything landed, which is the ordinary case.
 */
export function describeUnreached(noEmail: string[], failed: string[] = []): string {
  const parts: string[] = []
  if (noEmail.length > 0) parts.push(`No email on file for ${names(noEmail)}.`)
  // No instruction to press anything: the Tell the crew button is back on
  // screen beside this, because a run with failures is not stamped as told.
  if (failed.length > 0) parts.push(`The email did not send to ${names(failed)}.`)
  return parts.join(' ')
}

/** Up to three by name, then a count — a crew list should not run off the row. */
function names(list: string[]): string {
  return list.length <= 3
    ? list.join(', ')
    : `${list.slice(0, 2).join(', ')} and ${list.length - 2} others`
}

/**
 * Asked before turning the job from a hold into a booking — AND before the
 * crew are told, because confirming does both.
 *
 * THIS PROMPT IS THE SAFETY (Dan, 2026-10-01: "I do want that to email the
 * crew. What I didn't want was the one switch flip to email the crew. The
 * popup handles the not one button to email the crew issue."). The risk he
 * named on 2026-09-30 was a toggle that reached thirty freelancers the instant
 * it moved; an OK/Cancel that says what is about to happen removes it, without
 * making the common case two separate trips.
 *
 * SO IT MUST KEEP SAYING THAT IT EMAILS. If this sentence is ever shortened to
 * just the status change, the guard is gone and the switch is back to sending
 * silently. Dan's words, pinned by a test.
 */
export const CONFIRM_SHOW_PROMPT =
  'Mark as confirmed\n\n' +
  'This marks the show as confirmed and emails the crew the show is confirmed.'

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
