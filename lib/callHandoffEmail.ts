// "This show is ready to crew" — the email that hands a show to its scheduler.
//
// Plain module, no 'use client': imported by an API route.
//
// The Resend client is constructed PER CALL, never at module scope. A top-level
// `new Resend(...)` throws during `next build` when the key is absent, which
// broke every Vercel Preview deployment on 2026-07-27.
//
// Deliberately contains no pay information. The scheduler may or may not hold
// can_view_pay_rates, and an email is the one surface where that check cannot
// be made per reader — so it carries none.

import { Resend } from 'resend'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

export type CallHandoffEmailInput = {
  to: string
  schedulerName: string | null
  showName: string
  venue: string | null
  startDate: string
  endDate: string
  organizationName: string
  approvedByName: string | null
  positionCount: number
  link: string
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(d: string) {
  // Bare 'YYYY-MM-DD' + T00:00:00 = local midnight; a date-only string parses as
  // UTC and renders as the previous day west of Greenwich.
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function buildCallHandoffEmail(input: CallHandoffEmailInput) {
  const dates = input.startDate === input.endDate
    ? fmtDate(input.startDate)
    : `${fmtDate(input.startDate)} – ${fmtDate(input.endDate)}`

  // Company and show name in the subject: a scheduler working several
  // organizations needs to know whose show this is from the inbox list alone.
  const subject = `${input.organizationName}: ${input.showName} is ready to crew`

  const greeting = input.schedulerName ? `Hi ${input.schedulerName},` : 'Hi,'
  const approvedBy = input.approvedByName ? ` by ${input.approvedByName}` : ''
  const positions = `${input.positionCount} position${input.positionCount === 1 ? '' : 's'}`

  const text = [
    greeting,
    '',
    `The crew call for ${input.showName} has been approved${approvedBy}, so it's ready for you to staff.`,
    '',
    `Show:   ${input.showName}`,
    input.venue ? `Venue:  ${input.venue}` : null,
    `Dates:  ${dates}`,
    `Call:   ${positions} to fill`,
    '',
    `Open it here: ${input.link}`,
    '',
    '— CrewTracker',
  ].filter(Boolean).join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(greeting)}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">
    The crew call for <strong>${escapeHtml(input.showName)}</strong> has been approved${escapeHtml(approvedBy)},
    so it&rsquo;s ready for you to staff.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 24px">
    <tr><td style="padding:6px 0;color:#71717a;width:80px">Show</td><td style="padding:6px 0">${escapeHtml(input.showName)}</td></tr>
    ${input.venue ? `<tr><td style="padding:6px 0;color:#71717a">Venue</td><td style="padding:6px 0">${escapeHtml(input.venue)}</td></tr>` : ''}
    <tr><td style="padding:6px 0;color:#71717a">Dates</td><td style="padding:6px 0">${escapeHtml(dates)}</td></tr>
    <tr><td style="padding:6px 0;color:#71717a">Call</td><td style="padding:6px 0">${escapeHtml(positions)} to fill</td></tr>
  </table>
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.link)}"
       style="display:inline-block;background:#3366CC;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">
      Open the show
    </a>
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">CrewTracker</p>
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
    const { error } = await new Resend(key).emails.send({
      from: FROM,
      to: input.to,
      subject,
      text,
      html,
    })
    if (error) return { error: error.message }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
