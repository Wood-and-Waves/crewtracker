import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { maybeSendReadyEmail, isExpectedReadyReason } from '@/lib/showReadiness'
import { logStaffingEvent } from '@/lib/staffingEvents'

// The scheduler recording an answer somebody gave them by phone or text.
//
// Most replies do not come back through the link. Dan: "The scheduler should
// also be able to accept or decline for the person's request." Without this the
// app's record drifts from the truth the moment anyone answers by phone — and a
// scheduler who cannot write down what they were told will stop using the
// screen that pretends otherwise.
//
// AUTHORIZATION IS RLS. Everything is read and written through the caller's
// session; the timecards policies already decide who may touch this show.
// Deliberately NOT the service role — unlike the public response route, there
// is a real logged-in user here whose permissions should apply.
//
// The invite row is updated in step with the timecards where one exists, so
// "what we asked" and "what they said" cannot disagree. It is not required to
// exist: a scheduler may pencil somebody in, ring them, and record the answer
// without ever sending a request.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // The scheduling module. Hiding a button is tidiness; THIS is the gate — a
  // switched-off organization must not be able to send crew requests or hand a
  // show off by posting here directly. Deliberately 403 with a plain reason
  // rather than a 404: the caller is legitimate, the feature simply isn't theirs.
  if (!canUseScheduling(await getCurrentUser())) {
    return NextResponse.json(
      { error: 'Scheduling is not enabled for this account.' },
      { status: 403 },
    )
  }

  let showId: string | undefined
  let crewMemberId: string | undefined
  let response: string | undefined
  let note: string | undefined
  try {
    ({ showId, crewMemberId, response, note } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!showId || !crewMemberId || (response !== 'confirmed' && response !== 'declined')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { data: show } = await supabase
    .from('shows').select('id, finalized_at').eq('id', showId).maybeSingle()

  if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 })
  if (show.finalized_at) {
    // Caught here rather than letting the finalized-show trigger raise, which
    // would surface as an opaque 500.
    return NextResponse.json({ error: 'This show has been closed out.' }, { status: 400 })
  }

  const { data: theirs, error: readError } = await supabase
    .from('timecards')
    .select('id, role, crew_member_name, rooms!inner ( work_days!inner ( show_id ) )')
    .eq('crew_member_id', crewMemberId)
    .eq('rooms.work_days.show_id', showId)

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })

  const ids = (theirs ?? []).map((t: any) => t.id)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'They are not booked on this show.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('timecards')
    .update({ booking_status: response, booking_responded_at: now })
    .in('id', ids)
    .select('id')

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })
  // A failing USING clause updates zero rows and still returns 200. Never read
  // the absence of an error as success.
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'You do not have permission to change this booking.' },
      { status: 403 },
    )
  }

  // Keep the conversation record in step. Absent invite = never asked through
  // the app, which is a normal way to work and not an error.
  await supabase
    .from('booking_invites')
    .update({
      responded_at: now,
      response,
      note: note?.slice(0, 500) || null,
    })
    .eq('show_id', showId)
    .eq('crew_member_id', crewMemberId)

  // The digest's diary, through the caller (their session, their actor id).
  await logStaffingEvent(supabase, {
    showId,
    kind: response === 'confirmed' ? 'accepted' : 'declined',
    crewMemberId,
    crewMemberName: (theirs?.[0] as any)?.crew_member_name ?? 'A crew member',
    role: (theirs?.[0] as any)?.role ?? null,
  })

  // A confirm recorded by hand can be the LAST one the show needed — the same
  // check the public response route runs. Dan (2026-09-07): hand-staffed crew
  // do not count as staffed until somebody has actually said yes, and this is
  // where the scheduler writes that yes down. Never fails the response.
  if (response === 'confirmed') {
    const { sent, reason } = await maybeSendReadyEmail(createAdminClient(), showId)
    if (!sent && !isExpectedReadyReason(reason)) {
      console.error('maybeSendReadyEmail failed after a recorded confirm:', reason)
    }
  }

  return NextResponse.json({ ok: true, response, days: updated.length })
}
