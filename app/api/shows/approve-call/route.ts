import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendCallHandoffEmail } from '@/lib/callHandoffEmail'

// Approve a show's crew call and hand it to a scheduler.
//
// AUTHORIZATION IS THE RLS POLICY, not a hand-written check — same approach as
// app/api/invites/send/route.ts, and for the same reason. The show is read and
// updated through the CALLER'S session, so `shows`' own policies decide whether
// they may touch it. A service-role write would mean re-implementing that rule
// here by hand, which is how the two quietly diverge.
//
// A show with no positions cannot be handed over: approving an empty call gives
// the scheduler nothing to do and is almost always a misclick. Checked here
// rather than in the UI alone, because the button is not the only way to reach
// this route.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let showId: string | undefined
  let schedulerId: string | undefined
  try {
    ({ showId, schedulerId } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!showId || !schedulerId) {
    return NextResponse.json({ error: 'Missing showId or schedulerId.' }, { status: 400 })
  }

  // Visible through the caller's session = they are entitled to it. Invisible
  // returns 404 and tells them nothing about whether it exists.
  const { data: show } = await supabase
    .from('shows')
    .select('id, name, venue, start_date, end_date, organization_id, call_approved_at')
    .eq('id', showId)
    .maybeSingle()

  if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 })
  if (show.call_approved_at) {
    return NextResponse.json({ error: 'This call has already been approved.' }, { status: 400 })
  }

  // The call must actually exist. Counted through the join rather than trusted
  // from the client.
  const { count } = await supabase
    .from('crew_call_positions')
    .select('id, rooms!inner(work_days!inner(show_id))', { count: 'exact', head: true })
    .eq('rooms.work_days.show_id', showId)

  if (!count) {
    return NextResponse.json(
      { error: 'Add at least one position to the crew call before handing this show over.' },
      { status: 400 },
    )
  }

  // The scheduler must be a live member of THIS show's organization. Without
  // this, a stale or tampered id could name someone from another company — and
  // the shows SELECT policy now admits scheduler_id, so that would be handing
  // an outsider visibility of the show.
  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('profile_id')
    .eq('profile_id', schedulerId)
    .eq('organization_id', show.organization_id)
    .is('deactivated_at', null)
    .maybeSingle()

  // A failed query is not the same as "they are not a member", and reporting it
  // as one sends the caller looking for a permissions problem that does not
  // exist. This exact conflation cost a debugging session here.
  if (membershipError) {
    return NextResponse.json(
      { error: `Could not check that person's membership: ${membershipError.message}` },
      { status: 500 },
    )
  }
  if (!membership) {
    return NextResponse.json(
      { error: 'That person is not an active member of this organization.' },
      { status: 400 },
    )
  }

  const { data: updated, error: updateError } = await supabase
    .from('shows')
    .update({
      scheduler_id: schedulerId,
      call_approved_at: new Date().toISOString(),
      call_approved_by: user.id,
    })
    .eq('id', showId)
    .select('id')

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }
  // An UPDATE whose USING clause fails affects zero rows and returns HTTP 200
  // with no error — silent success. Never treat "no error" as "it worked".
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'You do not have permission to hand off this show.' },
      { status: 403 },
    )
  }

  // Fetched separately rather than embedded in the membership query. An
  // embedded join returning nothing is indistinguishable from the parent row
  // being absent, which is precisely how a query problem gets misreported as a
  // permissions one.
  const [{ data: scheduler }, { data: org }, { data: approver }] = await Promise.all([
    supabase.from('profiles').select('full_name, email').eq('id', schedulerId).maybeSingle(),
    supabase.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
    supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle(),
  ])
  const to = scheduler?.email

  if (!to) {
    // The handoff itself succeeded and the show now shows as theirs in the app.
    // Report it honestly rather than failing the whole action.
    return NextResponse.json({
      ok: true,
      emailed: false,
      warning: 'Handed off, but that person has no email address on file, so no notification was sent.',
    })
  }

  const origin = new URL(request.url).origin
  const result = await sendCallHandoffEmail({
    to,
    schedulerName: (scheduler as any)?.full_name ?? null,
    showName: show.name,
    venue: show.venue,
    startDate: show.start_date,
    endDate: show.end_date,
    organizationName: org?.name ?? 'your team',
    approvedByName: approver?.full_name || approver?.email || null,
    positionCount: count,
    link: `${origin}/dashboard/shows/${show.id}`,
  })

  if (result.error) {
    // 200, not 502: unlike an invitation, the state change here is the point
    // and it has already happened. The show IS handed off and visible to them;
    // only the notification failed, so say exactly that.
    return NextResponse.json({
      ok: true,
      emailed: false,
      warning: `Handed off, but the email didn't send: ${result.error}`,
    })
  }

  return NextResponse.json({ ok: true, emailed: true, sentTo: to })
}
