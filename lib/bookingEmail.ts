// Asking a crew member to confirm a booking, and telling the scheduler when
// somebody declines.
//
// Plain module, no 'use client'. Resend is constructed PER CALL, never at
// module scope — a top-level `new Resend(...)` throws during `next build` when
// the key is absent, which broke every Preview deploy on 2026-07-27.
//
// THE REQUEST EMAIL CARRIES NO MONEY. No rate, no total, nothing derived from
// one. Whether crew see their rate was a per-show setting Dan wanted eventually;
// until that exists the safe default is to say nothing. It also names no other
// crew member, and none of show_notes / job_number / client_company.
//
// buildBookingRequestText() is the SMS version — the same facts, no link, for a
// scheduler who would rather text. That is deliberate: this app sends crew
// messages from the sender's own device (see SendHoursButton) rather than
// through a paid SMS gateway, and a texted action-link is also exactly the
// shape of a phishing message.

import { Resend } from 'resend'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/** "Aug 2–4" when contiguous, otherwise every date listed. */
export function describeDates(dates: string[]): string {
  if (dates.length === 0) return 'dates to be confirmed'
  if (dates.length === 1) return fmtDate(dates[0])
  const sorted = [...dates].sort()
  const contiguous = sorted.every((d, i) => {
    if (i === 0) return true
    const prev = new Date(sorted[i - 1] + 'T00:00:00')
    prev.setDate(prev.getDate() + 1)
    return prev.toISOString().slice(0, 10) === d
  })
  return contiguous
    ? `${fmtDate(sorted[0])} – ${fmtDate(sorted[sorted.length - 1])} (${sorted.length} days)`
    : sorted.map(fmtDate).join(', ')
}

export type BookingRequestInput = {
  to: string
  crewName: string
  showName: string
  venue: string | null
  cityState: string | null
  organizationName: string
  role: string | null
  dates: string[]
  link: string
}

export function buildBookingRequestEmail(input: BookingRequestInput) {
  const when = describeDates(input.dates)
  const where = input.venue || input.cityState || null
  const subject = `${input.organizationName}: are you available for ${input.showName}?`

  const text = [
    `Hi ${input.crewName},`,
    '',
    `${input.organizationName} would like to book you for ${input.showName}.`,
    '',
    input.role ? `Role:   ${input.role}` : null,
    `Dates:  ${when}`,
    where ? `Where:  ${where}` : null,
    '',
    'Let them know if you can do it:',
    input.link,
    '',
    '— CrewTracker',
  ].filter(Boolean).join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">Hi ${escapeHtml(input.crewName)},</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">
    <strong>${escapeHtml(input.organizationName)}</strong> would like to book you for
    <strong>${escapeHtml(input.showName)}</strong>.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 24px">
    ${input.role ? `<tr><td style="padding:6px 0;color:#71717a;width:70px">Role</td><td style="padding:6px 0">${escapeHtml(input.role)}</td></tr>` : ''}
    <tr><td style="padding:6px 0;color:#71717a">Dates</td><td style="padding:6px 0">${escapeHtml(when)}</td></tr>
    ${where ? `<tr><td style="padding:6px 0;color:#71717a">Where</td><td style="padding:6px 0">${escapeHtml(where)}</td></tr>` : ''}
  </table>
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.link)}"
       style="display:inline-block;background:#3366CC;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">
      Confirm or decline
    </a>
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">CrewTracker</p>
</div>`.trim()

  return { subject, text, html }
}

/**
 * The same ask as plain text for a scheduler to paste into a text message.
 *
 * No link, on purpose. Dan asked for this explicitly, and it is right: an
 * action-link arriving by SMS is indistinguishable from a phishing text, and
 * the reply comes back to the scheduler by phone anyway — which is why they can
 * record the answer on the crew member's behalf.
 */
export function buildBookingRequestText(input: Omit<BookingRequestInput, 'to' | 'link'>): string {
  const when = describeDates(input.dates)
  const where = input.venue || input.cityState
  return [
    `Hi ${input.crewName.split(' ')[0]}, it's ${input.organizationName}.`,
    `Are you available for ${input.showName}${input.role ? ` as ${input.role}` : ''}?`,
    `${when}${where ? ` at ${where}` : ''}.`,
    'Let me know either way and I\'ll get you on the books.',
  ].join(' ')
}

export async function sendBookingRequestEmail(
  input: BookingRequestInput,
): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured (RESEND_API_KEY is missing).' }
  const { subject, text, html } = buildBookingRequestEmail(input)
  try {
    const { error } = await new Resend(key).emails.send({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error: error.message }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}

export type DeclineNoticeInput = {
  to: string
  recipientName: string | null
  crewName: string
  showName: string
  note: string | null
  link: string
}

export async function sendDeclineNoticeEmail(input: DeclineNoticeInput): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured.' }

  const subject = `${input.crewName} declined ${input.showName}`
  const text = [
    input.recipientName ? `Hi ${input.recipientName},` : 'Hi,',
    '',
    `${input.crewName} has declined ${input.showName}, so their position is open again.`,
    input.note ? `\nThey said: "${input.note}"` : null,
    '',
    input.link,
    '',
    '— CrewTracker',
  ].filter(Boolean).join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(input.recipientName ? `Hi ${input.recipientName},` : 'Hi,')}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    <strong>${escapeHtml(input.crewName)}</strong> has declined
    <strong>${escapeHtml(input.showName)}</strong>, so their position is open again.
  </p>
  ${input.note ? `<p style="font-size:14px;line-height:1.5;margin:0 0 20px;padding:12px;background:#f4f4f5;border-radius:8px">&ldquo;${escapeHtml(input.note)}&rdquo;</p>` : ''}
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.link)}"
       style="display:inline-block;background:#3366CC;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">
      Open the show
    </a>
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">CrewTracker</p>
</div>`.trim()

  try {
    const { error } = await new Resend(key).emails.send({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error: error.message }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
