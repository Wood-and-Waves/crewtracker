import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'

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
// THE UPDATE IS VERIFIED, and that is load-bearing twice over. An UPDATE that
// matches no policy returns success with zero rows, so without `.select()` a
// refusal would read as a success. And the `is('confirmed_at', null)` predicate
// makes the stamp a CLAIM: two presses landing together both read the column as
// null, but only the first UPDATE matches a row, so only one email is ever
// sent. Same shape as maybeSendReadyEmail's claim in lib/showReadiness.ts.

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
    const { data, error } = await supabase
      .from('shows')
      .update({ confirmed_at: null, confirmed_by: null })
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

  // The email goes here once its copy has been through Dan — see
  // lib/showConfirmedEmail.ts. Until then confirming is silent, which is the
  // safe half: a missing email is a gap, a wrong one is a message to real crew.
  return NextResponse.json({ ok: true, confirmed: true })
}
