import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    .select('id, rooms!inner ( work_days!inner ( show_id ) )')
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

  return NextResponse.json({ ok: true, response, days: updated.length })
}
