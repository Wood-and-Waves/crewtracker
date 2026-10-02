import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/session'
import { sendShowConfirmedEmails } from '@/lib/showConfirmedEmail'

// TELLING THE CREW THE SHOW IS CONFIRMED — the second, deliberate press.
//
// Dan, 2026-09-30: "Sending an autoemail when the mark show as confirmed get
// hit feels too risky." So /api/shows/confirm changes the flag and reaches
// nobody; this is the only thing in the app that sends that email, and it exists
// precisely so that pressing it is a decision rather than a side effect.
//
// SAME AUTHORIZATION AS CONFIRMING, and by the same mechanism: a verified
// UPDATE through the caller's own session, so the `shows` UPDATE policy decides.
// No hand-written permission check, and no scheduler arm — sending word to the
// crew that a job is on is the show builder's act, like confirming it.
//
// THE STAMP IS CLAIMED BEFORE SENDING, so two presses landing together cannot
// both send: only the first UPDATE matches a row. Unlike the ready email this
// claim is NOT conditional on being null, because a second notice is a
// legitimate thing to want — somebody booked after the first one went out. What
// it stops is a double-press, not a second decision.
//
// A RE-SEND GOES TO EVERYBODY, not just the newly added. Working out who has
// already been told needs per-person bookkeeping, and the honest alternative is
// to say when the last notice went out and let whoever presses it decide — the
// same shape as "Send the invitation again" on the PM chip.

export async function POST(request: NextRequest) {
  let body: { showId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { showId } = body
  if (!showId) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  // You cannot tell people a show is confirmed when it is not. Read through the
  // caller's session, so a show they cannot see is simply not found.
  const { data: show } = await supabase
    .from('shows').select('id, confirmed_at, confirmed_notice_sent_at').eq('id', showId).maybeSingle()
  if (!show) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (!show.confirmed_at) {
    return NextResponse.json({ error: 'Mark the show confirmed first.' }, { status: 400 })
  }

  const stampedAt = new Date().toISOString()
  const previous = show.confirmed_notice_sent_at ?? null

  // Claim first. This is also the authorization: if the policy refuses, no row
  // comes back and nothing is sent.
  const { data: claimed, error: claimError } = await supabase
    .from('shows')
    .update({ confirmed_notice_sent_at: stampedAt })
    .eq('id', showId)
    .select('id')

  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 400 })
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'You do not have permission to change this show.' }, { status: 403 })
  }

  const notice = await sendShowConfirmedEmails(createAdminClient(), showId)

  // ANY FAILURE RELEASES THE CLAIM, not just a total one. A partial send used to
  // stay stamped, which left the people it had refused with no second attempt
  // and no button to make one. Releasing means a retry writes to everybody
  // again — which the prompt says out loud — and that is the lesser evil
  // against somebody silently never hearing.
  //
  // Nothing sent because there was nobody to write to is NOT a failure and
  // keeps its stamp, or the button sits there forever on a show with no crew.
  if (notice.failed.length > 0) {
    console.error('[showConfirmed] some notices did not send', notice.failed)
    const { error: releaseError } = await supabase
      .from('shows')
      .update({ confirmed_notice_sent_at: previous })
      .eq('id', showId)
    if (releaseError) {
      console.error('[showConfirmed] claim stuck after a failed send', releaseError.message)
    }
    if (notice.sent === 0) {
      return NextResponse.json(
        { error: 'None of the emails sent. Nothing has been recorded — try again.' },
        { status: 502 },
      )
    }
  }

  return NextResponse.json({
    ok: true,
    emailed: notice.sent,
    // Named rather than counted: somebody with no address on file is told by
    // NOBODY, and whoever pressed this is the only one able to ring them.
    noEmail: notice.noEmail,
    failed: notice.failed.map(f => f.name),
    sentAt: stampedAt,
  })
}
