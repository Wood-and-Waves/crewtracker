// "This show has been sent to scheduling" — the email that puts a show in the
// scheduling queue for everyone who can staff it.
//
// Plain module, no 'use client': imported by an API route.
//
// The Resend client is constructed PER CALL, never at module scope. A top-level
// `new Resend(...)` throws during `next build` when the key is absent, which
// broke every Vercel Preview deployment on 2026-07-27.
//
// Deliberately contains no pay information. The recipient may or may not hold
// can_view_pay_rates, and an email is the one surface where that check cannot
// be made per reader — so it carries none.

import { sendEmail } from '@/lib/sendEmail'
import { describeShowDates } from '@/lib/pmInviteEmail'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

export type CallHandoffEmailInput = {
  to: string
  recipientName: string | null
  showName: string
  venue: string | null
  startDate: string
  endDate: string
  organizationName: string
  sentByName: string | null
  /** Already-phrased size, e.g. "12 crew across 5 days". Never a raw row count. */
  callSize: string
  link: string
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildCallHandoffEmail(input: CallHandoffEmailInput) {
  const dates = describeShowDates(input.startDate, input.endDate)

  // Company and show name in the subject: a scheduler working several
  // organizations needs to know whose show this is from the inbox list alone.
  // JUST THE SHOW AND WHAT IS WANTED (Dan, 2026-09-09). It used to carry the
  // company, the crew count and the dates as well — 95 characters, of which an
  // inbox shows 40 to 60, so everything useful was cut off. All of it is in the
  // first two lines of the body.
  const subject = `${input.showName} is ready for staffing`

  // First name, as every other email in the app does.
  const greeting = input.recipientName ? `Hi ${input.recipientName.split(' ')[0]},` : 'Hi,'
  const sentBy = input.sentByName ? ` by ${input.sentByName}` : ''
  // NOT the position-row count. Positions are stored per room per day, so a
  // five-day show needing twelve people has sixty rows — and an email saying
  // "60 positions to fill" reads as a crisis rather than a normal week.
  const positions = input.callSize

  const text = [
    greeting,
    '',
    `${input.showName} has been sent to scheduling${sentBy}.`,
    '',
    input.venue ? `Venue:      ${input.venue}` : null,
    `Dates:      ${dates}`,
    `Positions:  ${positions}`,
    '',
    `Open it here: ${input.link}`,
    '',
    'Sent from CrewTracker.app',
  ].filter(Boolean).join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(greeting)}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">
    <strong>${escapeHtml(input.showName)}</strong> has been sent to scheduling${escapeHtml(sentBy)}.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 24px">
    ${input.venue ? `<tr><td style="padding:6px 0;color:#71717a;width:80px">Venue</td><td style="padding:6px 0">${escapeHtml(input.venue)}</td></tr>` : ''}
    <tr><td style="padding:6px 0;color:#71717a">Dates</td><td style="padding:6px 0">${escapeHtml(dates)}</td></tr>
    <tr><td style="padding:6px 0;color:#71717a">Positions</td><td style="padding:6px 0">${escapeHtml(positions)}</td></tr>
  </table>
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.link)}"
       style="display:inline-block;background:#3366CC;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">
      Open the show
    </a>
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">Sent from CrewTracker.app</p>
</div>`.trim()

  return { subject, text, html }
}

export async function sendCallHandoffEmail(
  input: CallHandoffEmailInput,
): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured (RESEND_API_KEY is missing).' }

  const { subject, text, html } = buildCallHandoffEmail(input)
  try {
    const { error } = await sendEmail({
      from: FROM,
      to: input.to,
      subject,
      text,
      html,
    })
    if (error) return { error }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
