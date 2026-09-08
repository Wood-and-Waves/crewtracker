// A show going fully staffed, told to its production manager once.
//
// Plain module, no 'use client'. Resend is constructed PER CALL, never at
// module scope — see lib/bookingEmail.ts for the build that taught us that.
//
// Sent by lib/showReadiness.ts, THE ONE PLACE this is decided: the last open
// position confirms, or (if the show was already full) the PM accepts. No
// money anywhere in it — phones are allowed, this is the PM's own crew.

import { sendEmail } from '@/lib/sendEmail'
import { addDays } from '@/lib/datetime'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** "Tue, Sep 8" — matches lib/bookingEmail.ts's fmtDate. */
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/**
 * "Tue 8" — built by hand: en-US with { weekday, day } renders "8 Tue"
 * because the locale's day-and-weekday pattern leads with the number when
 * there is no month to anchor it. Same style as describeDefDays.
 */
function fmtToken(d: string) {
  const date = new Date(d + 'T00:00:00')
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${date.getDate()}`
}

/**
 * A person's days on the show, compressed: consecutive dates become a
 * range ("Tue 8 – Thu 10"), a gap starts a new token ("Tue 8, Thu 10").
 * Always Weekday-D tokens, never a bare weekday — a date with no number is
 * ambiguous the moment a run crosses a week.
 */
export function compressDays(dates: string[]): string {
  const sorted = [...dates].sort()
  const groups: string[][] = []
  for (const d of sorted) {
    const last = groups[groups.length - 1]
    if (last && addDays(last[last.length - 1], 1) === d) {
      last.push(d)
    } else {
      groups.push([d])
    }
  }
  return groups
    .map(g => (g.length > 1 ? `${fmtToken(g[0])} – ${fmtToken(g[g.length - 1])}` : fmtToken(g[0])))
    .join(', ')
}

export type ReadyEmailInput = {
  to: string
  pmName: string | null
  showName: string
  /** Already formatted, e.g. "Sep 8–10" — use describeShowDates(). */
  dates: string
  venue: string | null
  orgName: string
  link: string
  days: {
    date: string
    label: string
    rooms: { name: string; people: { name: string; role: string | null; phone: string | null }[] }[]
  }[]
  perPerson: { name: string; role: string | null; days: string }[]
  waiting: number
}

export function buildReadyEmail(input: ReadyEmailInput): { subject: string; text: string; html: string } {
  const subject = `${input.orgName}: ${input.showName} is fully staffed`
  const where = [input.showName, input.dates, input.venue].filter(Boolean).join(' · ')
  const greeting = input.pmName ? `Hi ${input.pmName.split(' ')[0]},` : 'Hi,'

  const textDayBlocks: string[] = []
  const htmlDayBlocks: string[] = []
  for (const day of input.days) {
    const heading = day.label ? `${fmtDate(day.date)} · ${day.label}` : fmtDate(day.date)
    const lines = [`── ${heading}`]
    const roomsHtml: string[] = []
    for (const room of day.rooms) {
      lines.push(room.name)
      for (const p of room.people) {
        lines.push(`  ${p.name} · ${p.role || 'Crew'} · ${p.phone ?? 'no phone on file'}`)
      }
      roomsHtml.push(
        `<p style="font-size:14px;font-weight:600;margin:12px 0 4px">${escapeHtml(room.name)}</p>` +
          `<ul style="margin:0 0 8px;padding-left:20px;font-size:14px;line-height:1.6">` +
          room.people
            .map(
              p =>
                `<li>${escapeHtml(p.name)} · ${escapeHtml(p.role || 'Crew')} · ${escapeHtml(
                  p.phone ?? 'no phone on file',
                )}</li>`,
            )
            .join('') +
          `</ul>`,
      )
    }
    textDayBlocks.push(lines.join('\n'))
    htmlDayBlocks.push(`<h3 style="font-size:15px;margin:20px 0 4px">${escapeHtml(heading)}</h3>` + roomsHtml.join(''))
  }

  const perPersonText = input.perPerson.map(p => `${p.name} · ${p.role || 'Crew'} · ${p.days}`)
  const perPersonHtml = input.perPerson
    .map(p => `<li>${escapeHtml(p.name)} · ${escapeHtml(p.role || 'Crew')} · ${escapeHtml(p.days)}</li>`)
    .join('')

  const text = [
    greeting,
    '',
    `${where} is fully staffed.`,
    `${input.waiting} waiting on a reply`,
    '',
    ...textDayBlocks,
    '',
    "Everyone's days:",
    ...perPersonText,
    '',
    input.link,
    '',
    '— CrewTracker',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(greeting)}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 8px"><strong>${escapeHtml(where)}</strong> is fully staffed.</p>
  <p style="font-size:13px;color:#71717a;margin:0 0 16px">${input.waiting} waiting on a reply</p>
  ${htmlDayBlocks.join('')}
  <p style="font-size:14px;font-weight:600;margin:20px 0 4px">Everyone's days:</p>
  <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.6">${perPersonHtml}</ul>
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

export async function sendReadyEmail(input: ReadyEmailInput): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured.' }
  const { subject, text, html } = buildReadyEmail(input)
  try {
    const { error } = await sendEmail({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
