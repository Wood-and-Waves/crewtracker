import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSuperAdminId } from '@/lib/superadmin'

// Delete a pending invitation.
//
// Invitations carry a token that grants access, so a stale one is a live key
// sitting in an inbox — five had accumulated here, one already expired. There
// was no way to revoke any of them from the app.
//
// Service role because `invitations` has no DELETE policy for authenticated
// users; the super-admin check below is the gate.

export async function POST(request: Request) {
  const supabase = await createClient()
  if (!(await getSuperAdminId(supabase as any))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const inviteId = typeof body?.inviteId === 'string' ? body.inviteId : null
  if (!inviteId) {
    return NextResponse.json({ error: 'An invitation id is required.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Refuse to touch an already-accepted invitation: that row is the audit trail
  // of how someone joined, and deleting it destroys history rather than
  // revoking access (which accepting already spent).
  const { data: invite } = await admin
    .from('invitations').select('accepted_at').eq('id', inviteId).single()
  if (!invite) {
    return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 })
  }
  if (invite.accepted_at) {
    return NextResponse.json(
      { error: 'That invitation has already been accepted; it cannot be revoked.' },
      { status: 409 },
    )
  }

  const { error } = await admin.from('invitations').delete().eq('id', inviteId)
  if (error) {
    console.error('revoke-invite: delete failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
