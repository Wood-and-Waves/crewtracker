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
import { dayLabel } from '@/lib/dayActivities'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** "Sep 4–9", "Sep 28 – Oct 3", or "Sep 4" for a one-day show. */
/**
 * One line per day of the run: "Fri, Sep 4 — Travel".
 *
 * Dan, 2026-09-09: "It is all about the dates at this point. They should
 * receive the days and type of days that they are." A PM deciding whether they
 * can take a show is doing one thing — checking it against the rest of their
 * month — and a bare range cannot tell them whether the last day is a show day
 * or a load-out, which is the difference between finishing at 6pm and 2am.
 *
 * The label is dayLabel()'s, the same words the day header shows on screen, so
 * the email and the app cannot describe a day differently.
 */
export function describeRunDays(days: PmInviteDay[]): string[] {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      const when = new Date(d.date + 'T00:00:00')
        .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      const label = dayLabel(d.activities)
      return label ? `${when} — ${label}` : when
    })
}

export function describeShowDates(start: string, end: string): string {
  const a = new Date(start + 'T00:00:00')
  const b = new Date(end + 'T00:00:00')
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  if (start === end) return `${month(a)} ${a.getDate()}`
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${month(a)} ${a.getDate()}–${b.getDate()}`
  return `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`
}

/** A day of the run, as the invitation needs it: when, and what happens. */
export type PmInviteDay = { date: string; activities: string[] }

export type PmInviteInput = {
  to: string
  pmName: string | null
  showName: string
  /** Already formatted, e.g. "Sep 4–9" — use describeShowDates(). */
  dates: string
  /** Every day of the run, so the PM can check it against their own month. */
  days: PmInviteDay[]
  venue: string | null
  orgName: string
  /** Both answers are BUTTONS IN THE EMAIL (Dan, 2026-09-08). Accept is one
   *  tap and done; Decline opens the page on its note step, because a decline
   *  carries a message back to whoever invited them. */
  acceptUrl: string
  declineUrl: string
}

export function buildPmInviteEmail(input: PmInviteInput) {
  // Written to sit INSIDE a sentence: "the production manager on Northwind
  // User Conference, Sep 4-9 at Moscone West." The dot-separated version this
  // replaced ("Show · Sep 4-9 · Venue") reads as a header, not as speech, and
  // the invitation is somebody asking somebody else for a favour.
  const when = [input.showName, input.dates].filter(Boolean).join(', ')
  const where = input.venue ? `${when} at ${input.venue}` : when
  // INVITED, never "named" (Dan, 2026-09-09: it "should make sense. Not be
  // assuming and be warm"). The word is also the honest one: being named writes
  // a pointer and nothing else, and the show does not open for them until they
  // say yes. The company name leads the subject on purpose — a freelancer who
  // works for four production companies wants to know which one is calling
  // before they open it.
  const subject = `${input.orgName}: you're invited to PM ${input.showName}`
  // THE COMPANY INVITES, not a named person (Dan, 2026-09-09). This used to
  // read "Dan Smith at Wood & Waves Productions has invited you"; a PM works
  // for the company, and a personal name goes stale the moment that person
  // leaves. The page says the same thing, so the two cannot drift.
  const by = input.orgName

  const runDays = describeRunDays(input.days)

  const text = [
    input.pmName ? `Hi ${input.pmName.split(' ')[0]},` : 'Hi,',
    '',
    `${by} has invited you to be the production manager on ${where}.`,
    '',
    ...(runDays.length ? [...runDays, ''] : []),
    'Accept:',
    input.acceptUrl,
    '',
    'Decline:',
    input.declineUrl,
    '',
    'Sent from CrewTracker.app',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(input.pmName ? `Hi ${input.pmName.split(' ')[0]},` : 'Hi,')}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    ${escapeHtml(by)} has invited you to be the production manager on
    <strong>${escapeHtml(input.showName)}</strong>${escapeHtml(where.slice(input.showName.length))}.
  </p>
  ${runDays.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:15px;line-height:1.6">
    ${runDays.map(line => {
      const [when, what] = line.split(' — ')
      return `<tr><td style="padding:1px 14px 1px 0;white-space:nowrap;color:#52525b">${escapeHtml(when)}</td><td style="padding:1px 0"><strong>${escapeHtml(what ?? '')}</strong></td></tr>`
    }).join('\n    ')}
  </table>` : ''}
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.acceptUrl)}"
       style="display:inline-block;background:#1A7F37;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:600">
      Accept
    </a>
    <a href="${escapeHtml(input.declineUrl)}"
       style="display:inline-block;margin-left:10px;background:#C0392B;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:600">
      Decline
    </a>
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">Sent from CrewTracker.app</p>
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
  /** The show itself. Whoever invited them is going to open it and invite
   *  somebody else, so the email carries the way there (Dan, 2026-09-09). */
  link: string
}

export function buildPmDeclinedEmail(input: PmDeclinedInput) {
  const subject = `${input.pmName} declined PM on ${input.showName}`
  const text = [
    input.inviterName ? `Hi ${input.inviterName.split(' ')[0]},` : 'Hi,',
    '',
    `${input.pmName} declined the production manager role for ${input.showName}.`,
    // Their words, signed with their first name — the same shape as the crew
    // decline notice. The line that used to follow ("has no production manager
    // now — name somebody else") came out: it explained the mechanics, and
    // "name" is the word Dan rejected anyway.
    ...(input.note ? ['', `"${input.note}" - ${input.pmName.split(' ')[0]}`] : []),
    '',
    input.link,
    '',
    'Sent from CrewTracker.app',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(input.inviterName ? `Hi ${input.inviterName.split(' ')[0]},` : 'Hi,')}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    <strong>${escapeHtml(input.pmName)}</strong> declined the production manager role for
    <strong>${escapeHtml(input.showName)}</strong>.
  </p>
  ${input.note ? `<p style="font-size:15px;line-height:1.5;margin:0 0 20px;padding:12px 14px;background:#f4f4f5;border-radius:8px">&ldquo;${escapeHtml(input.note)}&rdquo; - ${escapeHtml(input.pmName.split(' ')[0])}</p>` : ''}
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
