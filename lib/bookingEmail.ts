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
import { dayTypeLabel } from '@/lib/dayTypes'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/**
 * "Thu 10" — for the SMS, where every character is a character.
 *
 * Assembled from two calls rather than one with { weekday, day }: that option
 * pair renders "10 Thu" in en-US, because the locale's day-and-weekday pattern
 * leads with the number when there is no month to anchor it.
 */
function fmtDateShort(d: string) {
  const date = new Date(d + 'T00:00:00')
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${date.getDate()}`
}

/**
 * One day of an engagement, as the crew member needs to understand it.
 *
 * `is_travel_day` is a day of travel and NO work. `travel_in_day` /
 * `travel_out_day` are additive — travel AND a full day's work, which is a
 * different commitment and the distinction people care about most when
 * deciding whether they can take a job.
 */
export type EngagementDay = {
  date: string
  isTravelDay: boolean
  travelIn: boolean
  travelOut: boolean
  /**
   * What the PRODUCTION is doing that day — load-in, rehearsal, show, load-out.
   * Complementary to the travel flags above, not a substitute: those say what
   * THIS PERSON is doing. "The production is loading in" and "you are
   * travelling" are different facts and a crew member deciding whether to take
   * the job wants both. Null when nobody has set one.
   *
   * A display field only. It never reaches lib/payroll.ts — see lib/dayTypes.ts.
   */
  dayType?: string | null
}

type Kind = 'work' | 'travel' | 'travel+work'

function kindOf(d: EngagementDay): Kind {
  if (d.isTravelDay) return 'travel'
  if (d.travelIn || d.travelOut) return 'travel+work'
  return 'work'
}

const KIND_TEXT: Record<Exclude<Kind, 'work'>, string> = {
  'travel': 'travel',
  'travel+work': 'travel and work',
}

/**
 * The dates, plus what the travel days actually are.
 *
 * "Jul 28 – Aug 4 · first day travel, last day travel and work" rather than a
 * bare range. Dan asked for this specifically, and it is the difference between
 * a crew member being able to answer the question and having to ring someone:
 * an eight-day range where the first day is travel and the last is travel plus
 * a full day's work is a very different job from eight days on site.
 */
export function describeDateParts(days: EngagementDay[]): { range: string; qualifiers: string | null } {
  const full = describeDates(days)
  const i = full.indexOf(' · ')
  return i === -1
    ? { range: full, qualifiers: null }
    : { range: full.slice(0, i), qualifiers: full.slice(i + 3) }
}

export function describeDates(days: EngagementDay[]): string {
  if (days.length === 0) return 'dates to be confirmed'
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))

  const contiguous = sorted.every((d, i) => {
    if (i === 0) return true
    const prev = new Date(sorted[i - 1].date + 'T00:00:00')
    prev.setDate(prev.getDate() + 1)
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}` === d.date
  })

  const range = sorted.length === 1
    ? fmtDate(sorted[0].date)
    : contiguous
      ? `${fmtDate(sorted[0].date)} – ${fmtDate(sorted[sorted.length - 1].date)} (${sorted.length} days)`
      : sorted.map(d => fmtDate(d.date)).join(', ')

  if (sorted.length === 1) {
    const k = kindOf(sorted[0])
    return k === 'work' ? range : `${range} · ${KIND_TEXT[k]} only`
  }

  const first = kindOf(sorted[0])
  const last = kindOf(sorted[sorted.length - 1])
  const middle = sorted.slice(1, -1)
    .map((d, i) => ({ d, k: kindOf(d), i }))
    .filter(x => x.k !== 'work')

  const parts: string[] = []
  // Collapse the common symmetric case rather than saying the same thing twice.
  if (first !== 'work' && first === last) {
    parts.push(`first and last days ${KIND_TEXT[first]}`)
  } else {
    if (first !== 'work') parts.push(`first day ${KIND_TEXT[first]}`)
    if (last !== 'work') parts.push(`last day ${KIND_TEXT[last]}`)
  }
  // A travel day in the middle is unusual enough to name explicitly.
  for (const m of middle) parts.push(`${fmtDate(m.d.date)} ${KIND_TEXT[m.k as Exclude<Kind, 'work'>]}`)

  return parts.length ? `${range} · ${parts.join(', ')}` : range
}

/**
 * One line per day: the date, what the production is doing, and what this
 * person is doing.
 *
 * The two columns answer different questions and neither substitutes for the
 * other. `production` is the show's day type — everybody on that day shares it.
 * `you` is this person's own travel commitment, which is why two people on the
 * same Travel/Load-in day can legitimately have different answers.
 *
 * This is the single builder behind the email, the SMS and the /book page, so
 * what a crew member reads on the page always matches what they were sent.
 * describeDates() is deliberately untouched and still carries the summary —
 * see its header for why collapsing a run is the feature there.
 */
export function describeDayLines(
  days: EngagementDay[],
): { date: string; production: string | null; you: string | null }[] {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      const k = kindOf(d)
      return {
        date: fmtDate(d.date),
        production: dayTypeLabel(d.dayType),
        // 'work' adds nothing a crew member doesn't already assume.
        you: k === 'work' ? null : KIND_TEXT[k].replace(/^./, c => c.toUpperCase()),
      }
    })
}

/** True when at least one day has a production day type worth printing. */
export function hasAnyDayType(days: EngagementDay[]): boolean {
  return days.some(d => dayTypeLabel(d.dayType) !== null)
}

export type BookingRequestInput = {
  to: string
  crewName: string
  showName: string
  venue: string | null
  cityState: string | null
  organizationName: string
  role: string | null
  days: EngagementDay[]
  link: string
}

export function buildBookingRequestEmail(input: BookingRequestInput) {
  const when = describeDates(input.days)
  const where = input.venue || input.cityState || null
  const subject = `${input.organizationName}: are you available for ${input.showName}?`

  // The day-by-day schedule sits UNDER the Dates summary rather than replacing
  // it. The summary answers "how long is this and does it involve travel"; the
  // list answers "what happens on each day". Only shown when somebody actually
  // set day types — an unset run would otherwise print a column of blanks.
  const lines = describeDayLines(input.days)
  const showSchedule = hasAnyDayType(input.days)
  const scheduleText = showSchedule
    ? lines.map(l => {
        const right = [l.production, l.you].filter(Boolean).join(' · ')
        return `        ${l.date}${right ? `  ${right}` : ''}`
      })
    : []

  const text = [
    `Hi ${input.crewName},`,
    '',
    `${input.organizationName} would like to book you for ${input.showName}.`,
    '',
    input.role ? `Role:   ${input.role}` : null,
    `Dates:  ${when}`,
    ...scheduleText,
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
    ${showSchedule ? `<tr><td></td><td style="padding:2px 0 8px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${lines.map(l => `<tr>
          <td style="padding:3px 12px 3px 0;white-space:nowrap">${escapeHtml(l.date)}</td>
          <td style="padding:3px 0;color:#71717a">${escapeHtml([l.production, l.you].filter(Boolean).join(' · '))}</td>
        </tr>`).join('')}
      </table>
    </td></tr>` : ''}
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
  const { range, qualifiers } = describeDateParts(input.days)
  const where = input.venue || input.cityState
  // Company names very often already end in a period ("Northwind Staging Co."),
  // and "Co.." is the kind of detail that makes a message look automated.
  const org = input.organizationName.replace(/\.$/, '')

  // The day-by-day schedule, on ONE line rather than one line per day. Dan
  // asked for the full list here knowing a long run makes a long message; the
  // compact form is what keeps it pasteable into a text rather than turning it
  // into a document. Dates are shortened to "Thu 10" — unambiguous inside a run
  // and half the width of the email's format.
  //
  // Production day types only. The personal travel commitment is already its
  // own sentence above (`qualifiers`), and repeating it per day would say the
  // same thing twice at double the length.
  const schedule = hasAnyDayType(input.days)
    ? [...input.days]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(d => {
          const label = dayTypeLabel(d.dayType)
          return label ? `${fmtDateShort(d.date)} ${label}` : fmtDateShort(d.date)
        })
        .join(', ')
    : null

  return [
    `Hi ${input.crewName.split(' ')[0]}, it's ${org}.`,
    `Are you available for ${input.showName}${input.role ? ` as ${input.role}` : ''}${where ? ` at ${where}` : ''}?`,
    // The travel note is its own sentence rather than trailing after a
    // separator: it is the part people actually stop and read.
    `${range}.`,
    qualifiers ? `${qualifiers.charAt(0).toUpperCase()}${qualifiers.slice(1)}.` : null,
    schedule ? `${schedule}.` : null,
    "Let me know either way and I'll get you on the books.",
  ].filter(Boolean).join(' ')
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
