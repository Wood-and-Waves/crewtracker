import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendInviteEmail } from '@/lib/inviteEmail'

// Emails an invitation. Used both when one is first created and when an admin
// resends it from the Team screen.
//
// AUTHORIZATION IS THE RLS POLICY, not a hand-written check.
//
// The invitation is read through the CALLER'S session rather than the service
// role, so `invitations`' existing policy — organization_id = my_organization_id()
// AND can_manage_users — decides whether the row is visible at all. If it comes
// back, the caller is an admin of that organization; if it doesn't, they get a
// 404 and learn nothing. A service-role read would have meant re-implementing
// that rule here by hand, which is how the two diverge.
//
// Nothing else needs elevated access either: the organization's name and the
// inviter's name are both readable by a member of that organization.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let invitationId: string | undefined
  try {
    ({ invitationId } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!invitationId) return NextResponse.json({ error: 'Missing invitationId' }, { status: 400 })

  const { data: invite } = await supabase
    .from('invitations')
    .select('id, token, email, base_role, expires_at, accepted_at, organization_id')
    .eq('id', invitationId)
    .maybeSingle()

  if (!invite) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 })
  if (invite.accepted_at) {
    return NextResponse.json({ error: 'That invitation has already been accepted.' }, { status: 400 })
  }
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'That invitation has expired. Send a new one.' }, { status: 400 })
  }
  if (!invite.email) {
    // Link-only invites are a deliberate option in the invite modal — there is
    // simply nobody to send to.
    return NextResponse.json({ error: 'This invitation has no email address. Copy the link instead.' }, { status: 400 })
  }

  const [{ data: org }, { data: inviter }] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', invite.organization_id).maybeSingle(),
    supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle(),
  ])

  const origin = new URL(request.url).origin
  const result = await sendInviteEmail({
    to: invite.email,
    organizationName: org?.name ?? 'their team',
    // Falls back to the sender's email address: "dan@… invited you" is still
    // far more use to the recipient than an anonymous invitation.
    inviterName: inviter?.full_name || inviter?.email || null,
    inviterOrganizationName: org?.name ?? null,
    role: invite.base_role,
    link: `${origin}/invite/${invite.token}`,
    expiresAt: invite.expires_at,
  })

  if (result.error) {
    // 502, not 500: the invitation itself is fine and the link still works. The
    // caller shows "created, but the email didn't send — copy the link".
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  return NextResponse.json({ ok: true, sentTo: invite.email })
}
