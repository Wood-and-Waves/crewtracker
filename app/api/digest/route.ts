import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { describeEvent, sendDigestEmail, type StaffingEventKind } from '@/lib/digestEmail'
import { todayInZone } from '@/lib/showStatus'
import { siteOrigin } from '@/lib/siteOrigin'

// The evening digest cron (see vercel.json, 30 23 * * * — 11:30pm UTC). One
// email per show that is staffed and has something to report: an accepted PM,
// a ready email already sent (so this never fires before the show is real to
// them), not finalized, not archived, and at least one staffing_events row
// nobody has been told about yet.
//
// Same shape as app/api/keepalive/route.ts: GET, an optional CRON_SECRET
// bearer check (Vercel Cron sends it automatically once the env var exists;
// without it the route is public, same bargain the keepalive makes), service
// role throughout.
//
// PER-SHOW FAILURE NEVER FAILS THE RUN. A bad PM email, a send error, an
// unexpected exception — logged and skipped, and the next show still gets
// its digest. staffing_events rows for a failed show stay unsent, so the
// next run tries again rather than losing the event.

type EventRow = {
  id: string
  at: string
  kind: StaffingEventKind
  crew_member_id: string | null
  crew_member_name: string
  role: string | null
  days: string | null
}

type TimecardRow = {
  crew_member_id: string | null
  crew_member_name: string
  booking_status: 'pencilled' | 'invited' | 'confirmed' | 'declined' | null
}

/**
 * The CURRENT state of a person's booking on the show, not the state at the
 * moment the event happened. Matched by crew_member_id when the event has
 * one, else by name (an event logged for someone with no directory link, or
 * whose link changed since).
 */
function currentStatus(event: EventRow, timecards: TimecardRow[]): 'accepted' | 'waiting on reply' | 'declined' | 'released' {
  const mine = event.crew_member_id
    ? timecards.filter(t => t.crew_member_id === event.crew_member_id)
    : timecards.filter(t => t.crew_member_id === null && t.crew_member_name === event.crew_member_name)
  if (mine.length === 0) return 'released'
  if (mine.some(t => t.booking_status === 'confirmed')) return 'accepted'
  if (mine.some(t => t.booking_status === 'pencilled' || t.booking_status === 'invited')) return 'waiting on reply'
  return 'declined'
}

/** "Sep 7" from an en-CA "2026-09-07". */
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = createAdminClient()

  const { data: eligible, error: showsError } = await admin
    .from('shows')
    .select('id, name, timezone_identifier, pm_profile_id')
    .not('ready_email_sent_at', 'is', null)
    .not('pm_profile_id', 'is', null)
    .not('pm_accepted_at', 'is', null)
    .is('finalized_at', null)
    .not('archived', 'is', true)

  if (showsError) {
    console.error('digest: could not list eligible shows', showsError)
    return NextResponse.json({ ok: false, error: showsError.message }, { status: 500 })
  }

  let shows = 0
  let emails = 0

  for (const show of eligible ?? []) {
    try {
      const { data: events, error: eventsError } = await admin
        .from('staffing_events')
        .select('id, at, kind, crew_member_id, crew_member_name, role, days')
        .eq('show_id', show.id)
        .is('sent_at', null)
        .order('at')
      if (eventsError) {
        console.error(`digest: could not load events for show ${show.id}`, eventsError)
        continue
      }
      if (!events || events.length === 0) continue
      shows++

      const [{ data: pm }, { data: timecards }] = await Promise.all([
        admin.from('profiles').select('email, full_name').eq('id', show.pm_profile_id).maybeSingle(),
        admin.from('timecards').select('crew_member_id, crew_member_name, booking_status').eq('show_id', show.id),
      ])
      if (!pm?.email) {
        console.error(`digest: show ${show.id} has an accepted PM with no email on file`)
        continue
      }

      const timeZone = show.timezone_identifier || 'America/Chicago'
      const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
      const rows = events as EventRow[]
      const lines = rows.map(e => ({
        time: fmtTime.format(new Date(e.at)),
        text: describeEvent({ kind: e.kind, crewMemberName: e.crew_member_name, role: e.role, days: e.days }),
        status: currentStatus(e, (timecards ?? []) as TimecardRow[]),
      }))

      const { error: sendError } = await sendDigestEmail({
        to: pm.email,
        pmName: pm.full_name ?? null,
        showName: show.name,
        date: fmtDate(todayInZone(timeZone)),
        link: `${siteOrigin()}/dashboard/shows/${show.id}`,
        lines,
      })
      if (sendError) {
        console.error(`digest: send failed for show ${show.id}: ${sendError}`)
        continue
      }
      emails++

      const { error: markError } = await admin
        .from('staffing_events')
        .update({ sent_at: new Date().toISOString() })
        .in('id', rows.map(e => e.id))
      if (markError) {
        // The email went out but the rows didn't get marked — logged loudly
        // because the next run will otherwise resend the same lines.
        console.error(`digest: sent for show ${show.id} but could not mark events sent`, markError)
      }
    } catch (e) {
      console.error(`digest: unexpected failure for show ${show.id}`, e)
    }
  }

  return NextResponse.json({ ok: true, shows, emails })
}
