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

import { sendEmail } from '@/lib/sendEmail'
import { dayLabel } from '@/lib/dayActivities'

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
   * A display field only. It never reaches lib/payroll.ts — see
   * lib/dayActivities.ts. Empty or missing when nobody has set any.
   */
  activities?: readonly string[] | null
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
 * One line per day, WRITTEN FROM THE CREW MEMBER'S SIDE: "Travel in, then
 * work", "Rehearsal", "Show, then travel home".
 *
 * It used to print two facts side by side — what the PRODUCTION was doing and
 * what THIS PERSON was doing — which on a travel day produced
 * "Travel · Load-in · Travel and work": the word travel twice on one line, both
 * halves true and the whole thing gibberish. Dan, 2026-09-09, chose their side
 * only: it is their day they are checking, and the production's label is worth
 * printing only where it IS their day (Rehearsal, Show).
 *
 * So a travel-in day says what they do and drops the show's label; a travel-out
 * day keeps it, because they work that day and then go home; and an ordinary
 * day is simply the show's label. Null when nobody set a day type and there is
 * no travel either — there is nothing to say, and a column of blanks is worse
 * than no column.
 *
 * This is the single builder behind the email, the SMS, the /book page and the
 * change notice, so what a crew member reads on the page always matches what
 * they were sent.
 */
export function describeDayLines(
  days: EngagementDay[],
): { iso: string; date: string; text: string }[] {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      // THE SHOP'S OWN SHORTHAND (Dan, 2026-09-09: "Work + Travel. That is
      // more standard"). A day is what they do, joined with +; travel reads on
      // the side of the day it happens, so travelling in comes first and
      // travelling home comes last.
      //
      // When the person's OWN travel is stated, the production's travel is the
      // same trip and must not be printed as well — a load-out day tagged
      // travel gave "Load-out + Travel + Travel". Strip it, and what is left is
      // the work they are there to do; where nobody typed a day at all, that is
      // plain "Work", which is true of anybody booked and not travelling.
      // dayLabel joins with " · " for the app's own screens; on a crew-facing
      // line the whole day is written in the + shorthand, so the separator
      // matches rather than reading as two different notations in one line
      // ("Show, Load-out + Travel").
      const plus = (label: string | null) => label?.replace(/ · /g, ' + ') ?? null
      const work = plus(dayLabel((d.activities ?? []).filter(a => a !== 'travel'))) ?? 'Work'
      let text: string
      if (d.isTravelDay) text = 'Travel'
      else if (d.travelIn && d.travelOut) text = `Travel + ${work} + Travel`
      else if (d.travelIn) text = `Travel + ${work}`
      else if (d.travelOut) text = `${work} + Travel`
      else text = plus(dayLabel(d.activities)) ?? 'Work'
      return { iso: d.date, date: fmtDate(d.date), text }
    })
}

/** True when at least one day has production activities worth printing. */
export function hasAnyDayActivity(days: EngagementDay[]): boolean {
  return days.some(d => dayLabel(d.activities) !== null)
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
  /** The page. Kept for the SMS text, which carries no action link at all. */
  link: string
  /** The two BUTTONS (2026-09-08). Confirm answers on arrival; Decline opens
   *  the page with the note box ready, since a decline carries a message. */
  confirmUrl: string
  declineUrl: string
}

export function buildBookingRequestEmail(input: BookingRequestInput) {
  // The RANGE only. The travel note describeDates() appends ("first and last
  // days travel and work") is said again by every line of the list underneath,
  // and Dan cut the duplicate (2026-09-09). The SMS still carries the note,
  // because its compact day list is the one place travel would otherwise be
  // lost.
  const { range: when } = describeDateParts(input.days)
  const first = input.crewName.split(' ')[0]
  const where = input.venue || input.cityState || null
  const subject = `${input.organizationName}: are you available for ${input.showName}?`

  // The day-by-day schedule sits UNDER the Dates summary rather than replacing
  // it. The summary answers "how long is this and does it involve travel"; the
  // list answers "what happens on each day". Only shown when somebody actually
  // set day types — an unset run would otherwise print a column of blanks.
  const lines = describeDayLines(input.days)
  const showSchedule = lines.some(l => l.text)
  const scheduleText = showSchedule
    ? lines.map(l => `        ${l.date} - ${l.text}`)
    : []

  const text = [
    `Hi ${first},`,
    '',
    `${input.organizationName} would like to book you for ${input.showName}.`,
    '',
    input.role ? `Role:   ${input.role}` : null,
    `Dates:  ${when}`,
    ...scheduleText,
    where ? `Where:  ${where}` : null,
    '',
    'Accept:',
    input.confirmUrl,
    '',
    'Decline:',
    input.declineUrl,
    '',
    'Sent from CrewTracker.app',
  ].filter(Boolean).join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">Hi ${escapeHtml(first)},</p>
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
          <td style="padding:3px 0;color:#71717a">${escapeHtml(l.text ?? '')}</td>
        </tr>`).join('')}
      </table>
    </td></tr>` : ''}
    ${where ? `<tr><td style="padding:6px 0;color:#71717a">Where</td><td style="padding:6px 0">${escapeHtml(where)}</td></tr>` : ''}
  </table>
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.confirmUrl)}"
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

/**
 * The same ask as plain text for a scheduler to paste into a text message.
 *
 * No link, on purpose. Dan asked for this explicitly, and it is right: an
 * action-link arriving by SMS is indistinguishable from a phishing text, and
 * the reply comes back to the scheduler by phone anyway — which is why they can
 * record the answer on the crew member's behalf.
 */
export function buildBookingRequestText(
  // No links of any kind reach the SMS — see the note above.
  input: Omit<BookingRequestInput, 'to' | 'link' | 'confirmUrl' | 'declineUrl'>,
): string {
  const { range, qualifiers } = describeDateParts(input.days)
  const where = input.venue || input.cityState
  // Company names very often already end in a period ("Northwind Staging Co."),
  // and "Co.." is the kind of detail that makes a message look automated.
  const org = input.organizationName.replace(/\.$/, '')

  // ONE DAY PER LINE, and the day written the crew member's way — the same
  // wording as the email, so the two cannot disagree (Dan, 2026-09-09).
  //
  // It used to be one long paragraph carrying BOTH a travel sentence ("first
  // and last days travel and work") and a production-only day list ("Thu 10
  // Travel · Load-in"), which said travel twice and ran to 420 characters on a
  // ten-day show with nowhere for the eye to rest. This is pasted into a
  // person's own messaging app, so it can have a shape; line breaks cost
  // nothing and are what makes a long run readable.
  //
  // Dates are shortened to "Thu 10" — unambiguous inside a run and half the
  // width of the email's format — and the label's " · " becomes ", " because a
  // middot in a text message reads as a typo.
  const lines = describeDayLines(input.days)
  const schedule = lines.some(l => l.text)
    // The month is carried (Dan, 2026-09-09). This used to be a bare "Thu 10"
    // to save characters, which is exactly what misleads on a show booked in
    // October for January.
    ? lines.map(l => `${l.date} - ${l.text}`)
    : null

  const head = [
    `Hi ${input.crewName.split(' ')[0]}, it's ${org}.`,
    '',
    `Are you available for ${input.showName}${input.role ? ` as ${input.role}` : ''}${where ? ` at ${where}` : ''}?`,
    '',
  ]

  // Nobody set any day types: fall back to the range and the travel note,
  // which is all there is to say. A column of bare dates would be worse.
  // The count goes AFTER the list (Dan, 2026-09-09), where it reads as a
  // total rather than as a claim to check the lines against.
  const dayCount = input.days.length
  const body = schedule
    ? [...schedule, '', `${dayCount} ${dayCount === 1 ? 'day' : 'days'} total.`]
    : [`${range}.${qualifiers ? ` ${qualifiers.charAt(0).toUpperCase()}${qualifiers.slice(1)}.` : ''}`]

  return [...head, ...body, '', "Let me know either way and I'll get you on the books."].join('\n')
}

export async function sendBookingRequestEmail(
  input: BookingRequestInput,
): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured (RESEND_API_KEY is missing).' }
  const { subject, text, html } = buildBookingRequestEmail(input)
  try {
    const { error } = await sendEmail({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error }
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
    `${input.crewName} has declined ${input.showName}.`,
    // Their words, signed with their first name (Dan, 2026-09-09) — a quote
    // with nobody's name on it reads as the app talking. "so their position is
    // open again" came out: the scheduler is opening the show anyway, and the
    // sentence explained the mechanics rather than the news.
    input.note ? `\n"${input.note}" - ${input.crewName.split(' ')[0]}` : null,
    '',
    input.link,
    '',
    'Sent from CrewTracker.app',
  ].filter(Boolean).join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">${escapeHtml(input.recipientName ? `Hi ${input.recipientName},` : 'Hi,')}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    <strong>${escapeHtml(input.crewName)}</strong> has declined
    <strong>${escapeHtml(input.showName)}</strong>.
  </p>
  ${input.note ? `<p style="font-size:14px;line-height:1.5;margin:0 0 20px;padding:12px;background:#f4f4f5;border-radius:8px">&ldquo;${escapeHtml(input.note)}&rdquo; - ${escapeHtml(input.crewName.split(' ')[0])}</p>` : ''}
  <p style="margin:0 0 24px">
    <a href="${escapeHtml(input.link)}"
       style="display:inline-block;background:#3366CC;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">
      Open the show
    </a>
  </p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">Sent from CrewTracker.app</p>
</div>`.trim()

  try {
    const { error } = await sendEmail({ from: FROM, to: input.to, subject, text, html })
    if (error) return { error }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
