// The evening digest: one email per staffed show, telling its PM what
// changed today — booked, accepted, declined, released, moved, extended,
// days changed — each line stamped with the CURRENT state of that person's
// booking, not the state at the moment it happened. A decline logged at
// 9am and re-filled by 2pm should read "accepted" by the time the PM sees
// it at 11:30pm, not "declined" — that is app/api/digest's job, computing
// the status per line; this module only knows how to say a sentence and
// build an email once it is handed one.
//
// Plain module, no 'use client'. Resend is constructed PER CALL, never at
// module scope — see lib/bookingEmail.ts for the build that taught us that.
//
// No money anywhere in it. Every user-facing string says "positions", never
// "call".

import { sendEmail } from '@/lib/sendEmail'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type StaffingEventKind =
  | 'booked'
  | 'accepted'
  | 'declined'
  | 'released'
  | 'days_changed'
  | 'moved'
  | 'extended'

export type DescribableEvent = {
  kind: StaffingEventKind
  crewMemberName: string
  /** A blank/null role reads as "Crew" — same fallback as lib/readyEmail.ts. */
  role?: string | null
  /** Already formatted, e.g. "Tue 8 – Thu 10" — use compressDays(). */
  days?: string | null
}

/** One event, as a plain-English sentence — the digest's line text. */
export function describeEvent(e: DescribableEvent): string {
  const name = e.crewMemberName
  const role = e.role || 'Crew'
  const days = e.days || null
  switch (e.kind) {
    case 'booked':
      return `${name} booked as ${role}${days ? `, ${days}` : ''}`
    case 'accepted':
      return `${name} accepted ${role}`
    case 'declined':
      return `${name} declined ${role}`
    case 'released':
      return `${name} released from ${role}${days ? `, ${days}` : ''}`
    case 'days_changed':
      return days ? `${name}'s days changed to ${days} (${role})` : `${name}'s days changed (${role})`
    case 'moved':
      return days ? `${name} moved to ${days} (${role})` : `${name} moved (${role})`
    case 'extended':
      return days ? `${name} extended to ${days} (${role})` : `${name} extended (${role})`
  }
}

export type DigestLine = {
  /** "2:14 pm" — already formatted in the show's own timezone. */
  time: string
  /** describeEvent()'s sentence. */
  text: string
  /**
   * NO LONGER PRINTED (Dan, 2026-09-09). It was the person's state at SEND
   * time, printed after the event's own sentence, which produced lines like
   * "Bo Ellery declined Stagehand — accepted": two different moments, both
   * true, reading as the email contradicting itself. The digest is a record of
   * what happened today; where somebody stands now is on the show's own screen,
   * one click away.
   *
   * The field stays because app/api/digest still computes it and because it is
   * the honest way to bring the line back if it is ever wanted — but nothing
   * renders it, and reintroducing it means solving the two-moments problem
   * first.
   */
  status?: 'accepted' | 'waiting on reply' | 'declined' | 'released' | null
}

export type DigestEmailInput = {
  to: string
  pmName: string | null
  showName: string
  /** "Sep 7" — todayInZone(show timezone), formatted. */
  date: string
  link: string
  lines: DigestLine[]
}

export function buildDigestEmail(input: DigestEmailInput): { subject: string; text: string; html: string } {
  const subject = `${input.showName}: today's crew changes (${input.date})`
  const greeting = input.pmName ? `Hi ${input.pmName.split(' ')[0]},` : 'Hi,'

  const textLines = input.lines.map(l => `${l.time}  ${l.text}`)

  const text = [
    greeting,
    '',
    `${input.showName} — today's crew changes:`,
    '',
    ...textLines,
    '',
    input.link,
    '',
    'Sent by CrewTracker.app',
  ].join('\n')

  const rowsHtml = input.lines
    .map(
      l => `
    <tr>
      <td style="padding:6px 12px 6px 0;font-size:13px;color:#71717a;white-space:nowrap;vertical-align:top">${escapeHtml(l.time)}</td>
      <td style="padding:6px 0;font-size:14px;color:#18181b;vertical-align:top">${escapeHtml(l.text)}</td>
    </tr>`,
    )
    .join('')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(greeting)}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px"><strong>${escapeHtml(input.showName)}</strong> — today's crew changes:</p>
  <table style="border-collapse:collapse;width:100%;margin:0 0 20px">${rowsHtml}</table>
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.link)}"
       style="display:inline-block;background:#3366CC;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">
      Open the show
    </a>
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">Sent by CrewTracker.app</p>
</div>`.trim()

  return { subject, text, html }
}

export async function sendDigestEmail(input: DigestEmailInput): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured.' }
  const { subject, text, html } = buildDigestEmail(input)
  try {
    const { error } = await sendEmail({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
