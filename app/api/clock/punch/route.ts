import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayInZone } from '@/lib/showStatus'
import {
  PUNCH_ORDER, PUNCH_LABELS, getChronologyError, isEligibleForBatch, isWrapped,
  roundWallTime, type Punch, type PunchType,
} from '@/lib/punches'
import { zonedWallTimeToUtc, addDays } from '@/lib/datetime'

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
// SHOW's timezone and pinned to the work day the server resolved — never a
// date from the browser. So somebody can correct "I actually started at 8"
// without calling the PM, but a bookmarked link still cannot reach another
// day. Omitting `at` means now.
//
// The picked time is snapped to organizations.timecard_rounding_minutes.
// That is a DIFFERENT operation from the rounding calculateNetHours does to a
// finished day's net minutes — see roundWallTime for why they are not
// interchangeable.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  let body: { token?: string; timecardId?: string; punchType?: string; at?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { token, timecardId, punchType, at } = body
  if (!token || !timecardId || !UUID.test(token) || !UUID.test(timecardId)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  // Whitelist against the enum rather than trusting the check constraint to
  // reject it with something a crew member could read.
  if (!punchType || !(PUNCH_ORDER as readonly string[]).includes(punchType)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const type = punchType as PunchType

  // HH:MM, 24-hour. Rejected rather than coerced: a time we cannot parse must
  // never quietly become "now" and land a punch hours from where the person
  // meant it.
  if (at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
    return NextResponse.json({ error: 'Invalid time.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: link } = await admin
    .from('clock_links')
    .select('id, show_id, crew_member_id, expires_at, revoked_at')
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
  if (new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This link has expired. Ask your PM for a new one.' }, { status: 400 })
  }

  const { data: show } = await admin
    .from('shows').select('id, organization_id, timezone_identifier, finalized_at').eq('id', link.show_id).maybeSingle()
  if (!show) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

  // Checked BEFORE writing. punches_blocked_when_finalized is a TRIGGER, and
  // the service role does not bypass triggers — so a punch on a closed-out show
  // would otherwise surface to a crew member as a raw 500.
  if (show.finalized_at) {
    return NextResponse.json({
      error: 'This show has been closed out, so times can no longer be changed. Talk to your PM.',
    }, { status: 400 })
  }

  // The timecard must be THIS person's, and it must be TODAY's — today being
  // resolved from the show's timezone, never the server's and never the
  // caller's. This is what stops a bookmarked link back-dating yesterday.
  const timeZone = show.timezone_identifier || 'America/Chicago'
  const today = todayInZone(timeZone)

  const { data: timecard } = await admin
    .from('timecards')
    .select('id, crew_member_id, is_travel_day, rooms!inner ( work_days!inner ( date, show_id ) )')
    .eq('id', timecardId)
    .maybeSingle()

  const room = Array.isArray((timecard as any)?.rooms) ? (timecard as any).rooms[0] : (timecard as any)?.rooms
  const workDay = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days

  if (
    !timecard ||
    timecard.crew_member_id !== link.crew_member_id ||
    workDay?.show_id !== show.id ||
    workDay?.date !== today
  ) {
    return NextResponse.json({ error: "That isn't one of today's shifts." }, { status: 400 })
  }
  if (timecard.is_travel_day) {
    return NextResponse.json({ error: 'Today is marked as a travel day, so there are no punches to record.' }, { status: 400 })
  }

  const { data: existing } = await admin
    .from('punches')
    .select('id, punch_type, punched_at, source')
    .eq('timecard_id', timecardId)

  const mine = (existing || []).find(p => p.punch_type === type)

  // A punch the PM entered is theirs. Crew may fix their OWN mistake but must
  // never overwrite a correction — which is exactly what the source column is
  // for.
  if (mine && mine.source !== 'crew') {
    return NextResponse.json({
      error: `Your ${PUNCH_LABELS[type]} was set by your PM, so it can't be changed here. Ask them.`,
    }, { status: 400 })
  }

  const all: Punch[] = (existing || [])
    .map(p => ({ id: p.id, punch_type: p.punch_type as PunchType, punched_at: p.punched_at }))

  // ORDER, which chronology does NOT cover. getChronologyError only checks
  // that the times of punches that EXIST run forwards; it is perfectly happy
  // to accept an M1 In when there is no M1 Out, because there is no earlier
  // time to contradict. The "the previous punch must exist" rule is a separate
  // one, and isEligibleForBatch is where this app already keeps it — reused
  // here rather than written a second time, so a new meal type stays a
  // one-place change.
  //
  // Skipped when somebody is correcting a punch they made themselves: the
  // punch already exists, so eligibility would reject it and chronology is the
  // right judge instead.
  if (!mine && !isEligibleForBatch(all, timecard.is_travel_day, type)) {
    // 'end' needs a start, not the meal before it — everything else needs its
    // immediate predecessor.
    const requirement: PunchType | null =
      type === 'start' ? null
      : type === 'end' ? 'start'
      : PUNCH_ORDER[PUNCH_ORDER.indexOf(type) - 1]
    const why = isWrapped(all) && type !== 'end'
      ? 'You’ve already wrapped for today.'
      : requirement
        ? `Your ${PUNCH_LABELS[requirement]} isn’t recorded yet.`
        : 'That isn’t available right now.'
    return NextResponse.json({ error: `${why} Ask your PM if that’s not right.` }, { status: 400 })
  }

  // The instant being recorded. `at` is a wall-clock time in the SHOW's zone
  // on the work day the server already resolved, so the date is never the
  // caller's to choose. No `at` means now, which is what the tracker's own
  // "punch now" does.
  const { data: org } = await admin
    .from('organizations').select('timecard_rounding_minutes')
    .eq('id', show.organization_id).maybeSingle()
  const roundingMinutes = org?.timecard_rounding_minutes ?? 1

  const wall = at ?? new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())

  // Snapped server-side, not just stepped in the picker: `step` on a time
  // input is a hint browsers let you type past, and this is the value that
  // gets paid.
  const { timeStr, dayOffset } = roundWallTime(wall, roundingMinutes)
  const now = zonedWallTimeToUtc(addDays(today, dayOffset), timeStr, timeZone)

  // Chronology, re-run server-side against every OTHER punch. Excluding this
  // type matches TimeEntryModal: replacing a punch must not be blocked by the
  // value it is replacing.
  const others: Punch[] = all.filter(p => p.punch_type !== type)

  const chronologyError = getChronologyError(now, type, others)
  if (chronologyError) {
    return NextResponse.json({ error: chronologyError }, { status: 400 })
  }

  // Update-or-insert, never a blind insert: nothing in the database prevents a
  // second punch of the same type, so a blind insert would silently duplicate.
  const written = mine
    ? await admin.from('punches')
        .update({ punched_at: now.toISOString(), source: 'crew', source_link: link.id })
        .eq('id', mine.id).select('id')
    : await admin.from('punches')
        .insert({
          timecard_id: timecardId,
          punch_type: type,
          punched_at: now.toISOString(),
          source: 'crew',
          // No session, so nobody signed in authored this.
          created_by: null,
          source_link: link.id,
        }).select('id')

  if (written.error || !written.data || written.data.length === 0) {
    return NextResponse.json({
      error: written.error?.message ?? 'That did not save. Try again, or tell your PM.',
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, punchType: type, punchedAt: now.toISOString() })
}
