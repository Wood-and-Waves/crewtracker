// Naming somebody production manager on a show, by email.
//
// Plain module, no 'use client'. Resend is constructed PER CALL, never at
// module scope — see lib/bookingEmail.ts for the build that taught us that.
//
// ACCEPTING IS WHAT GRANTS ACCESS (2026-09-07 show-flow spec, piece B). Being
// named writes nothing but a pointer and a token; the show reaches the person's
// CrewTracker only when they press Accept on the page this links to. Dan: a
// silent accept is dangerous. So this email is an OFFER, and it says so.
//
// Carries no money, no crew names, no show notes, no job number: the same rule
// as the crew booking request. The PM sees all of that once they are in.

import { sendEmail } from '@/lib/sendEmail'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** "Sep 4–9", "Sep 28 – Oct 3", or "Sep 4" for a one-day show. */
export function describeShowDates(start: string, end: string): string {
  const a = new Date(start + 'T00:00:00')
  const b = new Date(end + 'T00:00:00')
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  if (start === end) return `${month(a)} ${a.getDate()}`
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${month(a)} ${a.getDate()}–${b.getDate()}`
  return `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`
}

export type PmInviteInput = {
  to: string
  pmName: string | null
  showName: string
  /** Already formatted, e.g. "Sep 4–9" — use describeShowDates(). */
  dates: string
  venue: string | null
  orgName: string
  inviterName: string | null
  acceptUrl: string
}

export function buildPmInviteEmail(input: PmInviteInput) {
  const where = [input.showName, input.dates, input.venue].filter(Boolean).join(' · ')
  const subject = `${input.orgName}: you're named PM on ${input.showName}`
  const by = input.inviterName ? `${input.inviterName} at ${input.orgName}` : input.orgName

  const text = [
    input.pmName ? `Hi ${input.pmName.split(' ')[0]},` : 'Hi,',
    '',
    `${where} — you've been named production manager by ${by}.`,
    '',
    'Open the show to accept it — it lands in your CrewTracker straight away, and the page that opens can decline it instead if it is not yours.',
    '',
    input.acceptUrl,
    '',
    '— CrewTracker',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(input.pmName ? `Hi ${input.pmName.split(' ')[0]},` : 'Hi,')}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    <strong>${escapeHtml(where)}</strong> — you've been named production manager by ${escapeHtml(by)}.
  </p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">
    Open the show to accept it — it lands in your CrewTracker straight away, and the page that
    opens can decline it instead if it is not yours.
  </p>
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.acceptUrl)}"
       style="display:inline-block;background:#3366CC;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">
      Accept the show
    </a>
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">CrewTracker</p>
</div>`.trim()

  return { subject, text, html }
}

export async function sendPmInviteEmail(input: PmInviteInput): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured.' }
  const { subject, text, html } = buildPmInviteEmail(input)
  try {
    const { error } = await sendEmail({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}

// ---------------------------------------------------------------------------
// "They said no" — back to whoever named them
// ---------------------------------------------------------------------------
//
// Sent when a PM declines (lib/pmInvite.ts). The show has already gone back to
// having no PM by the time this lands, so the email is the only thing that
// tells the person who has to act on it. Their NOTE is carried through whole
// and unedited (Dan, 2026-09-08: "when a decline happens they can add a note to
// the scheduler") — the reason is usually the useful part, and paraphrasing
// somebody's "I'm on another show that week" helps nobody.

export type PmDeclinedInput = {
  to: string
  inviterName: string | null
  pmName: string
  showName: string
  orgName: string
  note: string | null
}

export function buildPmDeclinedEmail(input: PmDeclinedInput) {
  const subject = `${input.pmName} declined PM on ${input.showName}`
  const text = [
    input.inviterName ? `Hi ${input.inviterName.split(' ')[0]},` : 'Hi,',
    '',
    `${input.pmName} declined the production manager role on ${input.showName}.`,
    ...(input.note ? ['', `They said: "${input.note}"`] : []),
    '',
    `${input.showName} has no production manager now — name somebody else when you have one.`,
    '',
    '— CrewTracker',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(input.inviterName ? `Hi ${input.inviterName.split(' ')[0]},` : 'Hi,')}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    <strong>${escapeHtml(input.pmName)}</strong> declined the production manager role on
    <strong>${escapeHtml(input.showName)}</strong>.
  </p>
  ${input.note ? `<p style="font-size:15px;line-height:1.5;margin:0 0 16px;padding:12px 14px;background:#f4f4f5;border-radius:8px">${escapeHtml(input.note)}</p>` : ''}
  <p style="font-size:14px;line-height:1.5;margin:0 0 20px">
    ${escapeHtml(input.showName)} has no production manager now — name somebody else when you have one.
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">CrewTracker</p>
</div>`.trim()

  return { subject, text, html }
}

export async function sendPmDeclinedEmail(input: PmDeclinedInput): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured.' }
  const { subject, text, html } = buildPmDeclinedEmail(input)
  try {
    const { error } = await sendEmail({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
