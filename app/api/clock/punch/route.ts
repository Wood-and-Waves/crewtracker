import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PUNCH_ORDER, type PunchType } from '@/lib/punches'
import { applyCrewPunch } from '@/lib/clockPunch'
import { isClockLinkExpired } from '@/lib/clockLinks'
import { rateLimitOr, clientIp } from '@/lib/rateLimit'

// A crew member recording their own punch, with no login.
//
// POST ONLY, DELIBERATELY — see app/api/bookings/respond/route.ts for the full
// reasoning. Chat clients and mail scanners prefetch URLs, and these links are
// designed to be pasted into Slack, so a GET that recorded a punch would be
// clocked in by the unfurler.
//
// SERVICE ROLE, so the token is the authorization. That also means this route
// is responsible for every rule the database does not enforce, and for punches
// the database enforces almost nothing: there is no chronology trigger, no
// uniqueness on (timecard_id, punch_type), and no check that a punch belongs to
// its work day. All of that lives in TypeScript components today, which the
// public page cannot be trusted to have run.
//
// WHAT THE TIME IS: a wall-clock HH:MM the crew member picks, read in the
// SHOW's timezone. The DATE is never sent — it comes from the work day the
// TIMECARD belongs to, which the server looks up. So the only reachable days
// are days this person is genuinely staffed on this show, and a hand-edited
// request cannot invent one. Omitting `at` means now.
//
// Crew may punch a day other than today (Dan, 2026-09-05 — they need to fix a
// punch missed on an earlier day). That deliberately loosens the original
// today-only rule. What still holds: the day must be a real work day of THIS
// show with a timecard for THIS person, and finalize is still the sign-off.
//
// The picked time is snapped to organizations.timecard_rounding_minutes.
// That is a DIFFERENT operation from the rounding calculateNetHours does to a
// finished day's net minutes — see roundWallTime for why they are not
// interchangeable.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  let body: { token?: string; timecardId?: string; punchType?: string; at?: string; clear?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { token, timecardId, punchType, at, clear } = body
  if (!token || !timecardId || !UUID.test(token) || !UUID.test(timecardId)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  // Whitelist against the enum rather than trusting the check constraint to
  // reject it with something a crew member could read.
  if (!punchType || !(PUNCH_ORDER as readonly string[]).includes(punchType)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const type = punchType as PunchType

  const admin = createAdminClient()
  // Throttled per link and per address, before the token is even looked up.
  // A person punches at most six times a day and corrects a few; the address
  // limit covers a room full of phones behind one venue wifi.
  const stop = await rateLimitOr(admin, [
    { key: `punch:${token}`, limit: 30, windowSeconds: 600 },
    { key: `punch-ip:${clientIp(request)}`, limit: 300, windowSeconds: 600 },
  ])
  if (stop) return stop

  // HH:MM, 24-hour. Rejected rather than coerced: a time we cannot parse must
  // never quietly become "now" and land a punch hours from where the person
  // meant it.
  if (at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
    return NextResponse.json({ error: 'Invalid time.' }, { status: 400 })
  }

  const { data: link } = await admin
    .from('clock_links')
    .select('id, show_id, crew_member_id, revoked_at')
    .eq('token', token)
    .maybeSingle()

  // A venue code identifies nobody, so it can never punch. It has to be traded
  // for a personal link first.
  if (!link || !link.crew_member_id) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }
  if (link.revoked_at) {
    return NextResponse.json({ error: 'This link has been turned off. Ask your PM for a new one.' }, { status: 400 })
  }
  const { data: show } = await admin
    .from('shows')
    .select('id, organization_id, timezone_identifier, finalized_at, end_date')
    .eq('id', link.show_id).maybeSingle()
  if (!show) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

  // Expiry comes from the SHOW, not from clock_links.expires_at, so a show
  // that got longer does not lock its crew out — see isClockLinkExpired.
  // Checked after the show loads, which is why it sits below the lookup.
  if (isClockLinkExpired(show.end_date, show.timezone_identifier || 'America/Chicago')) {
    return NextResponse.json({ error: 'This link has expired. Ask your PM for a new one.' }, { status: 400 })
  }

  // Everything from here — whose timecard, finalized, travel/absence, PM-owned
  // punches, order, chronology, rounding, the write — is lib/clockPunch.ts,
  // shared with the login route so the two can never disagree.
  const result = await applyCrewPunch(admin, {
    timecardId, type, at, clear: !!clear,
    crewMemberId: link.crew_member_id, showId: show.id,
    sourceLink: link.id, createdBy: null,
  })
  return NextResponse.json(result.body, { status: result.status })
}
