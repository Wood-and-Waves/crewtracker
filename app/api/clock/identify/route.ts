import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayInZone } from '@/lib/showStatus'
import { clockLinkExpiry, isClockLinkExpired } from '@/lib/clockLinks'

// Turning a VENUE code into somebody's own personal link.
//
// POST ONLY, DELIBERATELY, like app/api/bookings/respond. Link scanners and
// chat clients prefetch URLs — Slack unfurls every link pasted into a channel,
// and this feature's whole distribution model is pasting links into Slack. A
// GET that minted a credential would be minting one for the unfurler.
//
// SERVICE ROLE: the visitor has no login, so the venue token is the
// authorization. Explicit column lists everywhere — see lib/clockSession.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  let body: { token?: string; crewMemberId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { token, crewMemberId } = body
  if (!token || !crewMemberId || !UUID.test(token) || !UUID.test(crewMemberId)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: link } = await admin
    .from('clock_links')
    .select('id, show_id, crew_member_id, organization_id, revoked_at, created_by')
    .eq('token', token)
    .maybeSingle()

  // Only a VENUE code may identify somebody. A personal link already knows who
  // its holder is, so accepting one here would let anybody trade their own
  // link for somebody else's.
  if (!link || link.crew_member_id !== null) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }
  if (link.revoked_at) {
    return NextResponse.json({ error: 'This code has been turned off. Ask your PM for a new one.' }, { status: 400 })
  }
  const { data: show } = await admin
    .from('shows').select('id, end_date, timezone_identifier').eq('id', link.show_id).maybeSingle()
  if (!show) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

  // Expiry comes from the SHOW, not the stored column — see isClockLinkExpired.
  if (isClockLinkExpired(show.end_date, show.timezone_identifier || 'America/Chicago')) {
    return NextResponse.json({ error: 'This code has expired. Ask your PM for a new one.' }, { status: 400 })
  }

  // The named person must actually be working today. Without this the venue
  // code would mint a link for any crew_member_id in the org that somebody
  // could name — and a link that outlives the show they were never on.
  const timeZone = show.timezone_identifier || 'America/Chicago'
  const { data: workDay } = await admin
    .from('work_days').select('id').eq('show_id', show.id).eq('date', todayInZone(timeZone)).maybeSingle()
  if (!workDay) {
    return NextResponse.json({ error: 'Nothing is scheduled on this show today.' }, { status: 400 })
  }

  const { data: rooms } = await admin.from('rooms').select('id').eq('work_day_id', workDay.id)
  const roomIds = (rooms || []).map(r => r.id)
  const { data: staffed } = roomIds.length
    ? await admin.from('timecards').select('id')
        .eq('crew_member_id', crewMemberId).in('room_id', roomIds)
        .neq('booking_status', 'declined').limit(1)
    : { data: [] as { id: string }[] }

  if (!staffed || staffed.length === 0) {
    return NextResponse.json({ error: "You're not on the call for today on this show." }, { status: 400 })
  }

  // Already has one? Hand it back rather than rotating it — the whole point is
  // that the link is stable enough to bookmark.
  const { data: existing } = await admin
    .from('clock_links').select('token, revoked_at')
    .eq('show_id', show.id).eq('crew_member_id', crewMemberId).maybeSingle()

  if (existing && !existing.revoked_at) {
    return NextResponse.json({ token: existing.token })
  }
  if (existing?.revoked_at) {
    // Revoked on purpose by a PM. Minting a replacement here would undo that
    // with one tap, so it stays revoked and they go and ask.
    return NextResponse.json({ error: 'Your link was turned off. Ask your PM to reissue it.' }, { status: 400 })
  }

  const { data: made, error } = await admin
    .from('clock_links')
    .insert({
      show_id: show.id,
      crew_member_id: crewMemberId,
      organization_id: link.organization_id,
      // Attributed to whoever put the venue code up, since nobody is signed in.
      created_by: link.created_by,
      expires_at: clockLinkExpiry(show.end_date, timeZone),
    })
    .select('token')
    .single()

  if (error || !made) {
    // 23505 = two phones picked the same name at once and both inserted. The
    // row that won is the right answer for both.
    if ((error as { code?: string } | null)?.code === '23505') {
      const { data: raced } = await admin
        .from('clock_links').select('token')
        .eq('show_id', show.id).eq('crew_member_id', crewMemberId).maybeSingle()
      if (raced) return NextResponse.json({ token: raced.token })
    }
    return NextResponse.json({ error: 'Could not set up your link. Ask your PM.' }, { status: 500 })
  }

  return NextResponse.json({ token: made.token })
}
