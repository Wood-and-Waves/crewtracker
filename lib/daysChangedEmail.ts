// Telling a crew member their days on a show changed — offered (never forced)
// after a position move, a release, a room removal, or an Add-Day extension.
// See components/CrewChangeNotice.tsx and app/api/crew/days-changed/route.ts.
//
// Plain module, no 'use client'. Resend is constructed PER CALL, never at
// module scope — see lib/bookingEmail.ts for the build that taught us that.
//
// NO LINK. A crew member has no login (crew logins are schema-ready but not
// built), so there is nowhere to send them — this is a plain status update,
// answered by replying to whoever booked them. `link` stays in the input type
// only because every other builder in this family takes one; it is never
// rendered.
//
// NO MONEY, same rule as every crew-facing email in this app.

import { Resend } from 'resend'
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
  /** Never rendered — see the header note above. Kept for shape parity with
   *  the rest of this email family. */
  link?: string
}

export function buildDaysChangedEmail(input: DaysChangedInput) {
  const first = input.crewName.split(' ')[0]
  const subject = `${input.orgName}: your days on ${input.showName} changed`
  const where = input.venue ? ` (${input.venue})` : ''
  const lines = describeDayLines(input.days)
  const scheduleLines = lines.length
    ? lines.map(l => `${l.date}${l.production ? ` · ${l.production}` : ''}${l.you ? ` · ${l.you}` : ''}`)
    : ['No days']

  const text = [
    `Hi ${first},`,
    '',
    `Your days on ${input.showName}${where} have changed. Here is your current schedule:`,
    '',
    ...scheduleLines,
    '',
    'Questions? Reply to whoever booked you.',
    '',
    '— CrewTracker',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">Hi ${escapeHtml(first)},</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    Your days on <strong>${escapeHtml(input.showName)}${escapeHtml(where)}</strong> have changed. Here is your current schedule:
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px">
    ${lines.length
      ? lines.map(l => `<tr>
          <td style="padding:3px 12px 3px 0;white-space:nowrap">${escapeHtml(l.date)}</td>
          <td style="padding:3px 0;color:#71717a">${escapeHtml([l.production, l.you].filter(Boolean).join(' · '))}</td>
        </tr>`).join('')
      : `<tr><td style="padding:3px 0;color:#71717a">No days</td></tr>`}
  </table>
  <p style="font-size:14px;line-height:1.5;margin:0 0 20px">Questions? Reply to whoever booked you.</p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">CrewTracker</p>
</div>`.trim()

  return { subject, text, html }
}

export async function sendDaysChangedEmail(input: DaysChangedInput): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured.' }
  const { subject, text, html } = buildDaysChangedEmail(input)
  try {
    const { error } = await new Resend(key).emails.send({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error: error.message }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
