import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendShowConfirmedEmails } from '@/lib/showConfirmedEmail'


// Marking a show CONFIRMED — the client has sold it, so the scheduler books
// rather than pencils, and everybody already holding the dates is told.
//
// AUTHORIZATION IS THE `shows` UPDATE POLICY, through the caller's own session.
// No service role: that policy already says can_edit_timecards AND (sees all
// shows OR assigned OR created it), which is exactly who should be allowed to
// say a job is sold. It deliberately has no scheduler arm — sending a show to
// scheduling is the show builder's act and so is this — so a scheduler's write
// matches no row and is refused here rather than being checked by hand.
//
// THE UPDATE IS VERIFIED. An UPDATE that matches no policy returns success with
// zero rows, so without `.select()` a refusal would read as a success.
//
// CONFIRMING TELLS THE CREW, and the OK/Cancel in front of it is what makes
// that safe (Dan, 2026-10-01: "I do want that to email the crew. What I didn't
// want was the one switch flip to email the crew. The popup handles the not one
// button to email the crew issue."). The risk was a switch that reached thirty
// freelancers the instant it moved, not the fact that confirming tells people —
// so the guard is the prompt, which says what is about to happen, and the
// common case stays one trip. CONFIRM_SHOW_PROMPT carries that sentence and a
// test pins it.
//
// THE NOTICE STAMP IS ONLY SET IF SOMETHING ACTUALLY WENT. A confirmed show
// with nobody told is exactly the state that puts "Tell the crew" back on
// screen, so a failed send leaves a visible way to retry rather than a show
// that quietly believes its crew know. /api/shows/confirm/notify is that
// retry, and the same route re-sends later when somebody is booked after the
// fact.

export async function POST(request: NextRequest) {
  let body: { showId?: string; confirmed?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { showId, confirmed } = body
  if (!showId || typeof confirmed !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  // ---- Taking it back ------------------------------------------------------
  // Nobody is emailed. A show that was confirmed by mistake and put back is an
  // internal correction; telling the crew "actually, hold that" when they were
  // told an hour ago that it was on would be worse than saying nothing, and the
  // scheduler can ring the two people who care. The confirm slip says so.
  if (!confirmed) {
    // The notice stamp is cleared with it: a show that goes back to being a
    // hold and is later sold again is news worth sending a second time.
    const { data, error } = await supabase
      .from('shows')
      .update({ confirmed_at: null, confirmed_by: null, confirmed_notice_sent_at: null })
      .eq('id', showId)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'You do not have permission to change this show.' }, { status: 403 })
    }
    return NextResponse.json({ ok: true, confirmed: false })
  }

  // ---- Confirming ----------------------------------------------------------
  const { data, error } = await supabase
    .from('shows')
    .update({ confirmed_at: new Date().toISOString(), confirmed_by: user.id })
    .eq('id', showId)
    .is('confirmed_at', null)
    .select('id, name')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (!data || data.length === 0) {
    // Either already confirmed (a second press, or a race) or refused by the
    // policy. Tell those apart with a plain read, so somebody without
    // permission is not told the show is already done.
    const { data: seen } = await supabase.from('shows').select('confirmed_at').eq('id', showId).maybeSingle()
    if (seen?.confirmed_at) return NextResponse.json({ ok: true, confirmed: true, already: true })
    return NextResponse.json({ error: 'You do not have permission to change this show.' }, { status: 403 })
  }

  // After the stamp, never before: the show is confirmed whatever Resend does,
  // and sendShowConfirmedEmails never throws into this route.
  const notice = await sendShowConfirmedEmails(createAdminClient(), showId)
  if (notice.failed.length > 0) {
    console.error('[showConfirmed] some notices did not send', notice.failed)
  }

  // Nothing sent AND something tried = a real failure, so the show stays
  // "confirmed, nobody told" and the button comes back. Nothing sent because
  // there was nobody to write to is not a failure, and must still count as
  // told, or the button sits there forever on a show with no crew on it yet.
  const reached = notice.sent > 0 || notice.failed.length === 0
  if (reached) {
    const { error: stampError } = await supabase
      .from('shows')
      .update({ confirmed_notice_sent_at: new Date().toISOString() })
      .eq('id', showId)
    if (stampError) console.error('[showConfirmed] could not record the notice', stampError.message)
  }

  return NextResponse.json({
    ok: true,
    confirmed: true,
    emailed: notice.sent,
    // Named rather than counted: somebody with no address on file is told by
    // NOBODY, and whoever pressed this is the only one able to ring them.
    noEmail: notice.noEmail,
    failed: notice.failed.length,
  })
}
