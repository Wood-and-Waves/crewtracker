import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendDeclineNoticeEmail } from '@/lib/bookingEmail'
import { rateLimitOr, clientIp } from '@/lib/rateLimit'
import { siteOrigin } from '@/lib/siteOrigin'

// A crew member's answer to a booking request. No login: the token is the
// authorization, so this runs with the service role.
//
// POST ONLY, DELIBERATELY. Outlook Safe Links and Gmail both PREFETCH URLs in
// email — a GET that recorded the answer would be auto-confirmed by a scanner
// before the person ever read it. The emailed link opens a page; the page posts.
//
// A decline applies to the WHOLE show. Dan: "A decline is for the entire show.
// They would need to work everything." Every timecard of theirs on that show
// moves to 'declined', which frees each position: the partial unique index on
// timecards excludes declined rows, so the scheduler can put somebody else in
// without deleting the record that this person said no.

export async function POST(request: Request) {
  let token: string | undefined
  let response: string | undefined
  let note: string | undefined
  try {
    ({ token, response, note } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!token || (response !== 'confirmed' && response !== 'declined')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // An answer changes hands a few times at most, and each decline sends an
  // email — this is the throttle that turns a leaked link from an inbox-flood
  // button back into a link.
  const stop = await rateLimitOr(admin, [
    { key: `respond:${token}`, limit: 5, windowSeconds: 3600 },
    { key: `respond-ip:${clientIp(request)}`, limit: 30, windowSeconds: 3600 },
  ])
  if (stop) return stop

  const { data: invite } = await admin
    .from('booking_invites')
    .select('id, show_id, crew_member_id, organization_id, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json(
      { error: 'This request has expired. Please contact whoever booked you.' },
      { status: 400 },
    )
  }

  // Checked BEFORE writing. block_writes_when_finalized is a trigger, and the
  // service role does not bypass triggers — so a response to a closed-out show
  // would otherwise surface to a crew member as a raw 500.
  const { data: show } = await admin
    .from('shows')
    .select('id, name, finalized_at, scheduler_id, created_by')
    .eq('id', invite.show_id)
    .maybeSingle()

  if (!show) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  if (show.finalized_at) {
    return NextResponse.json(
      { error: 'This show has been closed out, so it can no longer be changed. Please contact whoever booked you.' },
      { status: 400 },
    )
  }

  const now = new Date().toISOString()

  const { error: inviteError } = await admin
    .from('booking_invites')
    .update({ responded_at: now, response, note: note?.slice(0, 500) || null })
    .eq('id', invite.id)

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 })
  }

  // Their timecards on this show. Fetched then updated by id: a nested filter
  // cannot be used as the target of an update.
  const { data: theirs } = await admin
    .from('timecards')
    .select('id, rooms!inner ( work_days!inner ( show_id ) )')
    .eq('crew_member_id', invite.crew_member_id)
    .eq('rooms.work_days.show_id', invite.show_id)

  const ids = (theirs ?? []).map((t: any) => t.id)
  if (ids.length > 0) {
    const { error: tcError } = await admin
      .from('timecards')
      .update({ booking_status: response, booking_responded_at: now })
      .in('id', ids)

    if (tcError) {
      return NextResponse.json({ error: tcError.message }, { status: 500 })
    }
  }

  // A confirm needs no announcement — the schedule shows it. A DECLINE is
  // actionable: somebody has to find a replacement, and the sooner they know
  // the better. Failure to notify never fails the response; the answer is
  // recorded either way and telling the crew member otherwise would be a lie.
  if (response === 'declined') {
    const notifyId = show.scheduler_id || show.created_by
    if (notifyId) {
      const [{ data: person }, { data: crew }] = await Promise.all([
        admin.from('profiles').select('email, full_name').eq('id', notifyId).maybeSingle(),
        admin.from('crew_members').select('full_name').eq('id', invite.crew_member_id).maybeSingle(),
      ])
      if (person?.email) {
        const origin = siteOrigin()  // never the Host header — see lib/siteOrigin.ts
        await sendDeclineNoticeEmail({
          to: person.email,
          recipientName: person.full_name ?? null,
          crewName: crew?.full_name ?? 'A crew member',
          showName: show.name,
          note: note?.slice(0, 500) || null,
          link: `${origin}/dashboard/shows/${show.id}`,
        })
      }
    }
  }

  return NextResponse.json({ ok: true, response })
}
