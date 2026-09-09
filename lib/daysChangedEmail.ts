// Telling a crew member their days on a show changed — offered (never forced)
// after a position move, a release, a room removal, or an Add-Day extension.
// See components/CrewChangeNotice.tsx and app/api/crew/days-changed/route.ts.
//
// Plain module, no 'use client'. Resend is constructed PER CALL, never at
// module scope — see lib/bookingEmail.ts for the build that taught us that.
//
// IT CARRIES THE SAME TWO BUTTONS AS THE BOOKING REQUEST (Dan, 2026-09-09).
// A changed schedule is a new question — the days somebody agreed to are not
// the days they are now being asked to work — so it must be answerable in the
// email, not just read. Accept confirms them on the new days; Decline takes
// them off the show and carries a note back, exactly as the original ask does.
//
// Both go through booking_invites and /book/[token], the machinery that was
// already there: no second answering path, no second way for an answer to
// arrive. The route mints a fresh token per notice, so an old link stops
// working the moment the schedule changes again.
//
// The OFF-THE-SHOW version has no buttons: there is nothing left to accept.
//
// NO MONEY, same rule as every crew-facing email in this app.

import { sendEmail } from '@/lib/sendEmail'
import { describeDayLines, type EngagementDay } from '@/lib/bookingEmail'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type DaysChangedInput = {
  to: string
  crewName: string
  showName: string
  orgName: string
  venue: string | null
  days: EngagementDay[]
  /** They are off the show entirely — pressed Remove, or released from the
   *  last day they held. Either way there is no schedule to print, so the
   *  email asks them to give the dates back instead. NOT the only way this
   *  branch is reached: an empty `days` takes it too, because "here is your
   *  current schedule: No days" is how you would word it if you were trying to
   *  be unkind (Dan, 2026-09-09). */
  removed?: boolean
  /** The dates they WERE holding, already compressed ("Sep 8 – Sep 10") — use
   *  compressDays(). Only app/api/bookings/remove can supply it: everywhere
   *  else the rows are already deleted by the time the notice is offered, so
   *  the sentence falls back to "the dates you were holding". */
  heldDates?: string | null
  /** The two answers, as in the booking request: Confirm answers on arrival,
   *  Decline opens /book with the note box ready. Omitted for a person with no
   *  email invite to hang them on, in which case the notice is read-only. */
  confirmUrl?: string | null
  declineUrl?: string | null
  /** Never rendered. Kept for shape parity with the rest of this family. */
  link?: string
}

export function buildDaysChangedEmail(input: DaysChangedInput) {
  const first = input.crewName.split(' ')[0]
  const where = input.venue ? ` (${input.venue})` : ''
  // No days left is the same news as Remove, however they got there.
  if (input.removed || input.days.length === 0) return buildRemovedEmail(input, first)
  const subject = `${input.orgName}: your days on ${input.showName} changed`
  const lines = describeDayLines(input.days)
  const canAnswer = !!(input.confirmUrl && input.declineUrl)
  const scheduleLines = lines.length
    ? lines.map(l => `${l.date} - ${l.text}`)
    : ['No days']

  const text = [
    `Hi ${first},`,
    '',
    `Your days on ${input.showName}${where} have changed. Here is your revised schedule:`,
    '',
    ...scheduleLines,
    '',
    ...(canAnswer ? [
      'Accept:',
      input.confirmUrl!,
      '',
      'Decline:',
      input.declineUrl!,
      '',
    ] : []),
    `Questions? Get in touch with ${input.orgName}.`,
    '',
    'Sent from CrewTracker.app',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">Hi ${escapeHtml(first)},</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    Your days on <strong>${escapeHtml(input.showName)}${escapeHtml(where)}</strong> have changed. Here is your revised schedule:
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px">
    ${lines.length
      ? lines.map(l => `<tr>
          <td style="padding:3px 12px 3px 0;white-space:nowrap">${escapeHtml(l.date)}</td>
          <td style="padding:3px 0;color:#71717a">${escapeHtml(l.text ?? '')}</td>
        </tr>`).join('')
      : `<tr><td style="padding:3px 0;color:#71717a">No days</td></tr>`}
  </table>
  ${canAnswer ? `<p style="margin:0 0 8px">
    <a href="${escapeHtml(input.confirmUrl!)}"
       style="display:inline-block;background:#1A7F37;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:600">
      Accept
    </a>
    <a href="${escapeHtml(input.declineUrl!)}"
       style="display:inline-block;margin-left:10px;background:#C0392B;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:600">
      Decline
    </a>
  </p>
  <p style="font-size:13px;color:#71717a;margin:0 0 20px">Declining takes you off the show, and you can leave a note.</p>` : ''}
  <p style="font-size:14px;line-height:1.5;margin:0 0 20px">Questions? Get in touch with ${escapeHtml(input.orgName)}.</p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">Sent from CrewTracker.app</p>
</div>`.trim()

  return { subject, text, html }
}

/**
 * "Please release your dates." Short on purpose: what happened, what to do,
 * who to ask. No reason given — the app does not know why, and a guessed
 * reason in an automated email is worse than none. No buttons either: there is
 * nothing left to accept.
 */
function buildRemovedEmail(input: DaysChangedInput, first: string) {
  // DAN'S OWN WORDING (2026-09-09), kept as he wrote it. Two things in it are
  // deliberate and easy to "improve" back into something worse:
  //
  //   * "The staffing needs have changed" says the show changed, not that the
  //     person did anything wrong. Nobody is told why, because the app does
  //     not know why.
  //   * "Please release the held dates" gives them the one thing they can act
  //     on. A freelancer holds dates; the useful news is that these are free.
  //
  // No venue: the show name is what they recognise, and the line reads as a
  // sentence rather than a record.
  const held = input.heldDates ? `the held dates of ${input.heldDates}` : 'the dates you were holding'
  const subject = `${input.orgName}: please release your dates for ${input.showName}`
  const text = [
    `Hi ${first},`,
    '',
    `The staffing needs have changed for ${input.showName}. Please release ${held}.`,
    '',
    `Questions? Get in touch with ${input.orgName}.`,
    '',
    'Sent from CrewTracker.app',
  ].join('\n')
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">Hi ${escapeHtml(first)},</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    The staffing needs have changed for <strong>${escapeHtml(input.showName)}</strong>. Please release
    ${escapeHtml(held)}.
  </p>
  <p style="font-size:14px;line-height:1.5;margin:0 0 20px">Questions? Get in touch with ${escapeHtml(input.orgName)}.</p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">Sent from CrewTracker.app</p>
</div>`.trim()
  return { subject, text, html }
}

export async function sendDaysChangedEmail(input: DaysChangedInput): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured.' }
  const { subject, text, html } = buildDaysChangedEmail(input)
  try {
    const { error } = await sendEmail({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
