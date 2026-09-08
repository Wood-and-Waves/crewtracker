import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPmInviteEmail, describeShowDates } from '@/lib/pmInviteEmail'
import { siteOrigin } from '@/lib/siteOrigin'
import { maybeSendReadyEmail, isExpectedReadyReason } from '@/lib/showReadiness'

// Naming (or clearing, or re-inviting) the production manager on a show.
//
// AUTHORIZATION IS THE shows UPDATE POLICY. The pointer is written through the
// CALLER'S session as a verified update — zero rows means they may not edit
// this show, and nothing else happens. Only after that does the service role
// do the housekeeping the caller's own policies would not allow: clearing a
// previous PM's `source='pm'` assignment (deleting show_assignments needs
// can_manage_users, and a show's creator need not be an admin) and minting the
// token.
//
// NAMING GRANTS NOTHING. The show_assignments row that actually opens the show
// is written by /api/pm/accept, when the person presses Accept — never here.
//
// RECORDING AN ACCEPTANCE IS THE ONE EXCEPTION, and it is deliberate (Dan,
// 2026-09-08: "I should also be able to accept for them as well"). A PM often
// says yes on the phone, exactly as crew do — and whoever can edit this show
// can already grant the same access by hand on Edit Show → Show Access. So the
// power is not new; this puts it where the answer arrives, and says in words
// that it opens the show to them. It is never automatic: naming still grants
// nothing on its own.
//
// Body: { showId, profileId }             name somebody (re-naming replaces)
//       { showId, profileId: null }       nobody is PM
//       { showId, profileId, resend: true } send the existing invitation again
//       { showId, markAccepted: true }    record that they said yes (grants it)

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let showId: string | undefined
  let profileId: string | null | undefined
  let resend: boolean | undefined
  let markAccepted: boolean | undefined
  try {
    ({ showId, profileId, resend, markAccepted } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!showId) return NextResponse.json({ error: 'Missing showId.' }, { status: 400 })

  const { data: show } = await supabase
    .from('shows')
    .select('id, name, venue, city_state, start_date, end_date, organization_id, pm_profile_id, finalized_at')
    .eq('id', showId)
    .maybeSingle()
  if (!show) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (markAccepted) {
    const pmId = show.pm_profile_id
    if (!pmId) return NextResponse.json({ error: 'Nobody is named as PM on this show.' }, { status: 400 })
    if (profileId && profileId !== pmId) {
      return NextResponse.json({ error: 'Somebody else is named on this show now. Reload and look again.' }, { status: 409 })
    }
    // Read first, write second: a membership that has gone means there is
    // nothing to grant, and stamping the show before finding that out would
    // leave it reading "accepted" with no access behind it.
    const { data: member } = await admin
      .from('memberships').select('profile_id')
      .eq('profile_id', pmId).eq('organization_id', show.organization_id).is('deactivated_at', null).maybeSingle()
    if (!member) return NextResponse.json({ error: 'They are no longer a member of this company.' }, { status: 400 })

    // The stamp, through the caller's session: zero rows means they may not
    // change this show, and nothing else happens. Same authorization as naming.
    const { data: ok } = await supabase.from('shows').update({ pm_accepted_at: now }).eq('id', show.id).select('id')
    if (!ok?.length) return NextResponse.json({ error: 'You cannot change this show.' }, { status: 403 })

    // The grant itself. A hand-granted assignment may already exist; then there
    // is nothing to add and nothing to relabel.
    const { data: existing } = await admin
      .from('show_assignments').select('id').eq('show_id', show.id).eq('profile_id', pmId).maybeSingle()
    if (!existing) {
      const { error } = await admin
        .from('show_assignments')
        .insert({ show_id: show.id, profile_id: pmId, source: 'pm' })  // organization_id: its trigger
      if (error) {
        // Never leave the show saying accepted with no access behind it.
        await supabase.from('shows').update({ pm_accepted_at: null }).eq('id', show.id)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
    // Their emailed link now finds an accepted invitation and says so rather
    // than granting a second time.
    await admin.from('pm_invites').update({ accepted_at: now })
      .eq('show_id', show.id).eq('profile_id', pmId).is('accepted_at', null)

    // A show can be fully staffed before its PM accepts — the same second path
    // into the ready email that /api/pm/accept covers. Never fails the record.
    const { sent, reason } = await maybeSendReadyEmail(admin, show.id)
    if (!sent && !isExpectedReadyReason(reason)) {
      console.error('maybeSendReadyEmail failed after a recorded PM accept:', reason)
    }
    return NextResponse.json({ ok: true, accepted: true })
  }

  if (resend) {
    if (!show.pm_profile_id || show.pm_profile_id !== profileId) {
      return NextResponse.json({ error: 'That person is no longer named on this show.' }, { status: 400 })
    }
    const { data: existing } = await admin
      .from('pm_invites').select('token, accepted_at')
      .eq('show_id', show.id).eq('profile_id', profileId).order('sent_at', { ascending: false }).limit(1).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'There is no invitation to resend. Name them again.' }, { status: 400 })
    if (existing.accepted_at) return NextResponse.json({ error: 'They have already accepted.' }, { status: 400 })
    // Re-sending must still prove the caller may edit the show: the same
    // verified update, touching only the sent-at stamp.
    const { data: ok } = await supabase.from('shows').update({ pm_invited_at: now }).eq('id', show.id).select('id')
    if (!ok?.length) return NextResponse.json({ error: 'You cannot change this show.' }, { status: 403 })
    return send(admin, user, show, show.pm_profile_id, existing.token)
  }

  // The pointer, through the caller. This is the authorization check.
  const { data: updated, error: updateError } = await supabase
    .from('shows')
    .update({ pm_profile_id: profileId ?? null, pm_invited_at: profileId ? now : null, pm_accepted_at: null })
    .eq('id', show.id)
    .select('id')
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!updated?.length) return NextResponse.json({ error: 'You cannot change this show.' }, { status: 403 })

  // Whoever held it through an invitation loses it: their access came from
  // accepting, and the show has moved on. A hand-granted (manual) assignment
  // is somebody else's decision and stays.
  await admin.from('show_assignments').delete().eq('show_id', show.id).eq('source', 'pm')
  await admin.from('pm_invites').delete().eq('show_id', show.id)

  if (!profileId) return NextResponse.json({ ok: true, sentTo: null })

  // The invitee must be a live member of THIS company.
  const { data: member } = await admin
    .from('memberships').select('profile_id')
    .eq('profile_id', profileId).eq('organization_id', show.organization_id).is('deactivated_at', null).maybeSingle()
  if (!member) return NextResponse.json({ error: 'That person is not a member of this company.' }, { status: 400 })

  const { data: invite, error: inviteError } = await admin
    .from('pm_invites')
    .insert({ show_id: show.id, profile_id: profileId, organization_id: show.organization_id, sent_by: user.id })
    .select('token')
    .single()
  if (inviteError || !invite) return NextResponse.json({ error: inviteError?.message ?? 'Could not create the invitation.' }, { status: 500 })

  return send(admin, user, show, profileId, invite.token)
}

async function send(
  admin: ReturnType<typeof createAdminClient>,
  user: { fullName: string | null },
  show: { id: string; name: string; venue: string | null; city_state: string | null; start_date: string; end_date: string; organization_id: string },
  profileId: string,
  token: string,
) {
  const [{ data: pm }, { data: org }] = await Promise.all([
    admin.from('profiles').select('email, full_name').eq('id', profileId).maybeSingle(),
    admin.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
  ])
  if (!pm?.email) return NextResponse.json({ ok: true, sentTo: null, warning: 'They have no email address on file, so no invitation was sent.' })

  const { error } = await sendPmInviteEmail({
    to: pm.email,
    pmName: pm.full_name ?? null,
    showName: show.name,
    dates: describeShowDates(show.start_date, show.end_date),
    venue: show.venue || show.city_state || null,
    orgName: org?.name ?? 'Your company',
    inviterName: user.fullName,
    // ?accept=1: the link IS the acceptance (2026-09-08). The page it opens
    // confirms it and can hand the show straight back. Never the Host header —
    // see lib/siteOrigin.ts.
    acceptUrl: `${siteOrigin()}/pm/${token}?accept=1`,
  })
  // The naming happened either way; only the email did not. Say so rather
  // than pretend, and let Resend on Edit Show try again.
  if (error) return NextResponse.json({ ok: true, sentTo: pm.email, warning: `They are named, but the email did not send: ${error}` })
  return NextResponse.json({ ok: true, sentTo: pm.email })
}
