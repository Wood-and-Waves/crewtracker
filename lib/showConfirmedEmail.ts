// The client has confirmed the show — telling the crew who are holding dates.
//
// Dan, 2026-09-29: a client asks for a hold long before the job is sold, so
// until shows.confirmed_at existed the app could not tell the two apart and a
// scheduler said so by hand in every message. This is the message that used to
// be sent by hand.
//
// Plain module, no 'use client'. Every email leaves through lib/sendEmail.ts,
// which redirects to DEV_EMAIL_TO off production.
//
// WHO GETS IT: people who were ASKED or have ACCEPTED, never Not Asked. That is
// worthTelling() in lib/crewNotices.ts, reused rather than re-stated — somebody
// nobody has contacted has no hold to upgrade, and telling them a job is
// confirmed would be the first they ever heard of it.
//
// TWO VERSIONS OF ONE SENTENCE, because no single line is true for both groups.
// Someone who accepted is told the dates they accepted are now firm. Someone
// who never answered is told the dates are firm and asked to answer — and gets
// the ACCEPT and DECLINE buttons again, because telling somebody their response
// is needed in an email with no way to respond is a dead end.
//
// "FIRM" IS THE WORD, not "nothing to do" (Dan, 2026-09-30, rejecting the first
// draft as conversational rather than professional). It is the industry's own
// opposite of "hold", and it states what changed instead of reassuring the
// reader about it.
//
// THE COMPANY NAME LEADS THE SUBJECT, as it does in every other email this app
// sends — a freelancer who works for six companies needs to know which one is
// writing before they read anything else (see lib/pmInviteEmail.ts).
//
// IT CARRIES NO MONEY. No rate, no total, nothing derived from one; no other
// crew member; none of show_notes, job_number or client_company. Same rule as
// the booking request it follows.

import { sendEmail } from '@/lib/sendEmail'
import { describeDates, describeDayLines, type EngagementDay } from '@/lib/bookingEmail'
import { worthTelling } from '@/lib/crewNotices'
import { siteOrigin } from '@/lib/siteOrigin'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type ShowConfirmedEmailInput = {
  to: string
  crewName: string
  showName: string
  organizationName: string
  venue: string | null
  cityState: string | null
  role: string | null
  days: EngagementDay[]
  /** They have accepted. False = asked and has not answered yet. */
  accepted: boolean
  /** Only for the unanswered, and only while their invite is still live. */
  confirmUrl?: string | null
  declineUrl?: string | null
}

export function buildShowConfirmedEmail(
  input: ShowConfirmedEmailInput,
): { subject: string; text: string; html: string } {
  const first = input.crewName.split(' ')[0]
  // BOTH the building and the city: the venue names where, the city says
  // whether this is a drive or a flight. Same rule as the booking request,
  // where `venue || cityState` was a bug.
  const where = [input.venue, input.cityState].filter(Boolean).join(', ') || null
  const when = describeDates(input.days)
  const subject = `${input.organizationName}: ${input.showName} is confirmed`

  const lines = describeDayLines(input.days)
  const showSchedule = lines.some(l => l.text)

  // The one sentence that differs. Both say the dates are firm, because that is
  // the news; only the second asks for anything.
  const canAnswer = !input.accepted && !!input.confirmUrl && !!input.declineUrl
  const lead = input.accepted
    ? `${input.organizationName} has confirmed ${input.showName}. The dates you accepted are now firm.`
    : canAnswer
      ? `${input.organizationName} has confirmed ${input.showName}. The dates below are now firm. Please accept or decline.`
      // No live invite to answer through, so no instruction that cannot be
      // followed. They reply to whoever booked them.
      : `${input.organizationName} has confirmed ${input.showName}. The dates below are now firm.`

  const text = [
    `Hi ${first},`,
    '',
    lead,
    '',
    input.role ? `Role:   ${input.role}` : null,
    `Dates:  ${when}`,
    ...(showSchedule ? lines.map(l => `        ${l.date} - ${l.text}`) : []),
    where ? `Where:  ${where}` : null,
    ...(canAnswer ? ['', 'Accept:', input.confirmUrl!, '', 'Decline:', input.declineUrl!] : []),
    '',
    // A person pressed the toggle, so "from" rather than "by" — the rule lives
    // in lib/sendEmail.ts.
    'Sent from CrewTracker.app',
    // filter(l => l !== null), NOT filter(Boolean): the '' entries above are
    // deliberate blank lines, and Boolean drops every one of them — which is
    // why the booking request's plain text has arrived as a single dense block
    // since it was written (found 2026-09-30).
  ].filter(l => l !== null).join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:15px;margin:0 0 16px">Hi ${escapeHtml(first)},</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">
    <strong>${escapeHtml(input.organizationName)}</strong> has confirmed
    <strong>${escapeHtml(input.showName)}</strong>.
    ${input.accepted
      ? 'The dates you accepted are now firm.'
      : canAnswer
        ? 'The dates below are now firm. Please accept or decline.'
        : 'The dates below are now firm.'}
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
  ${canAnswer ? `<p style="margin:0 0 24px">
    <a href="${escapeHtml(input.confirmUrl!)}"
       style="display:inline-block;background:#1A7F37;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:600">
      Accept
    </a>
    <a href="${escapeHtml(input.declineUrl!)}"
       style="display:inline-block;margin-left:10px;background:#C0392B;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:600">
      Decline
    </a>
  </p>` : ''}
  <p style="font-size:12px;color:#a1a1aa;margin:0">Sent from CrewTracker.app</p>
</div>`.trim()

  return { subject, text, html }
}

/** One person this show's confirmation concerns. */
export type ShowConfirmedRecipient = {
  crewMemberId: string
  crewName: string
  email: string | null
  role: string | null
  days: EngagementDay[]
  accepted: boolean
  token: string | null
}

/**
 * Who should be told, built from the show's live timecards.
 *
 * PURE, so the rules are testable without a database: who qualifies, how a
 * person in two rooms on one day becomes one day, and how their travel flags
 * are ORed rather than taken from whichever row came back last.
 *
 * A person's booking_status can differ across their days — asked for the show
 * days, never asked for the load-in — so `accepted` is true only when they have
 * accepted SOMETHING, and worthTelling() decides whether they hear from us at
 * all.
 */
export function collectShowConfirmedRecipients(
  rows: {
    crew_member_id: string | null
    crew_member_name?: string | null
    role?: string | null
    booking_status?: string | null
    is_travel_day?: boolean | null
    travel_in_day?: boolean | null
    travel_out_day?: boolean | null
    date: string
    activities?: readonly string[] | null
  }[],
  crewById: Map<string, { name: string; email: string | null }>,
  tokenByCrew: Map<string, string>,
): ShowConfirmedRecipient[] {
  type Acc = {
    statuses: (string | null | undefined)[]
    role: string | null
    byDate: Map<string, EngagementDay>
  }
  const acc = new Map<string, Acc>()

  for (const r of rows) {
    if (!r.crew_member_id || !r.date) continue
    const a: Acc = acc.get(r.crew_member_id) ?? { statuses: [], role: null, byDate: new Map() }
    a.statuses.push(r.booking_status)
    if (!a.role && r.role) a.role = r.role
    const prev = a.byDate.get(r.date)
    a.byDate.set(r.date, {
      date: r.date,
      isTravelDay: !!prev?.isTravelDay || r.is_travel_day === true,
      travelIn: !!prev?.travelIn || r.travel_in_day === true,
      travelOut: !!prev?.travelOut || r.travel_out_day === true,
      activities: prev?.activities ?? r.activities ?? [],
    })
    acc.set(r.crew_member_id, a)
  }

  const out: ShowConfirmedRecipient[] = []
  for (const [id, a] of acc) {
    if (!worthTelling(a.statuses)) continue
    const who = crewById.get(id)
    out.push({
      crewMemberId: id,
      crewName: who?.name ?? rows.find(r => r.crew_member_id === id)?.crew_member_name ?? 'there',
      email: who?.email ?? null,
      role: a.role,
      days: [...a.byDate.values()].sort((x, y) => x.date.localeCompare(y.date)),
      accepted: a.statuses.some(s => s === 'confirmed'),
      token: tokenByCrew.get(id) ?? null,
    })
  }
  return out.sort((x, y) => x.crewName.localeCompare(y.crewName))
}

export type ShowConfirmedSendResult = {
  sent: number
  /** Named so a scheduler can chase them rather than assuming everybody knows. */
  noEmail: string[]
  failed: { name: string; error: string }[]
}

/**
 * Tell everybody holding dates that the show is on.
 *
 * SERVICE ROLE, like maybeSendReadyEmail and the digest: authorization already
 * happened when the caller's own UPDATE matched a row, and this is the system
 * acting on that fact. Reading crew emails through the caller's session would
 * make the send depend on can_view_crew_contacts, which is a hidden permission
 * a PM may not hold — so a confirmation would silently reach nobody.
 *
 * NEVER THROWS into its caller. Confirming the show is the act; the emails are
 * its consequence, and a Resend failure must not make a completed confirmation
 * look failed. Every branch returns a summary instead.
 */
export async function sendShowConfirmedEmails(
  admin: any,
  showId: string,
): Promise<ShowConfirmedSendResult> {
  const empty: ShowConfirmedSendResult = { sent: 0, noEmail: [], failed: [] }
  try {
    const { data: show } = await admin
      .from('shows')
      .select('id, name, venue, city_state, organization_id')
      .eq('id', showId)
      .maybeSingle()
    if (!show) return empty

    const [{ data: org }, { data: timecards }, { data: invites }] = await Promise.all([
      admin.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
      // EXPLICIT COLUMNS, never select('*') — day_rate is on this table and the
      // service role bypasses the column lockdown that normally refuses it.
      admin
        .from('timecards')
        .select(`
          crew_member_id, crew_member_name, role, booking_status,
          is_travel_day, travel_in_day, travel_out_day,
          rooms!inner ( work_days!inner ( date, activities ) )
        `)
        .eq('show_id', showId),
      admin
        .from('booking_invites')
        .select('crew_member_id, token, expires_at')
        .eq('show_id', showId),
    ])

    const rows = ((timecards ?? []) as any[]).map(t => {
      const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
      const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
      return { ...t, date: wd?.date as string, activities: wd?.activities ?? [] }
    }).filter(r => r.date)

    const ids = [...new Set(rows.map(r => r.crew_member_id).filter(Boolean))] as string[]
    const { data: crew } = ids.length
      ? await admin.from('crew_members').select('id, full_name, email').in('id', ids)
      : { data: [] as any[] }

    const crewById = new Map<string, { name: string; email: string | null }>(
      ((crew ?? []) as any[]).map(c => [c.id, { name: c.full_name, email: c.email ?? null }]),
    )

    // A TOKEN ONLY COUNTS WHILE IT STILL WORKS. Invites expire at the earlier of
    // 30 days and the day after the show, so an old ask has a dead link — and
    // handing somebody a dead link is worse than handing them none, because it
    // looks like the app is broken rather than like there is nothing to press.
    const now = Date.now()
    const tokenByCrew = new Map<string, string>(
      ((invites ?? []) as any[])
        .filter(i => i.crew_member_id && i.token && Date.parse(i.expires_at) > now)
        .map(i => [i.crew_member_id, i.token]),
    )

    const recipients = collectShowConfirmedRecipients(rows, crewById, tokenByCrew)
    const result: ShowConfirmedSendResult = { sent: 0, noEmail: [], failed: [] }
    const origin = siteOrigin()  // never the Host header — see lib/siteOrigin.ts

    for (const r of recipients) {
      if (!r.email) {
        // Ordinary, not an error: plenty of crew are reached by text only. Named
        // so somebody can pass it on rather than assuming they know.
        result.noEmail.push(r.crewName)
        continue
      }
      const link = r.token ? `${origin}/book/${r.token}` : null
      const { subject, text, html } = buildShowConfirmedEmail({
        to: r.email,
        crewName: r.crewName,
        showName: show.name,
        organizationName: org?.name ?? 'the production team',
        venue: show.venue ?? null,
        cityState: show.city_state ?? null,
        role: r.role,
        days: r.days,
        accepted: r.accepted,
        confirmUrl: link ? `${link}?a=confirm` : null,
        declineUrl: link ? `${link}?a=decline` : null,
      })
      const { error } = await sendEmail({ from: FROM, to: r.email, subject, text, html })
      if (error) result.failed.push({ name: r.crewName, error: String(error) })
      else result.sent += 1
    }
    return result
  } catch (e: any) {
    console.error('[showConfirmed] send failed', e?.message ?? e)
    return empty
  }
}
