import { createAdminClient } from '@/lib/supabase/admin'
import InviteAuthForm from './InviteAuthForm'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('invitations')
    .select('organization_name, is_new_organization, email, accepted_at, expires_at')
    .eq('token', token)
    .single()

  if (!invite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Invalid Invite</h1>
          <p className="text-muted text-sm">This invite link doesn&apos;t exist.</p>
        </div>
      </div>
    )
  }

  if (invite.accepted_at) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Invite Already Used</h1>
          <p className="text-muted text-sm">This invite link has already been accepted.</p>
        </div>
      </div>
    )
  }

  if (new Date(invite.expires_at) < new Date()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Invite Expired</h1>
          <p className="text-muted text-sm">This invite link has expired. Ask for a new one.</p>
        </div>
      </div>
    )
  }

  // Does this address already have a CrewTracker login?
  //
  // Multi-organization makes this the NORMAL case, not an edge one: a second
  // company inviting an existing user is the whole point of the feature. Without
  // this check the form offered "Create Account", and Supabase deliberately does
  // nothing when asked to sign up an address that already exists — it will not
  // confirm or deny that an email is registered. So the page said "check your
  // email", no email ever arrived, and the invite stayed pending with no error
  // shown anywhere. Reported by Dan on 2026-07-27, first time the flow was used.
  //
  // Not an enumeration risk: the invite was addressed TO this email and the token
  // is unguessable, so whoever opened the link already knows the address.
  // profiles mirrors auth.users one-to-one via the on_auth_user_created trigger.
  const { data: existing } = invite.email
    ? await admin.from('profiles').select('id').ilike('email', invite.email).maybeSingle()
    : { data: null }

  return (
    <InviteAuthForm
      token={token}
      orgName={invite.organization_name}
      isNewOrg={invite.is_new_organization}
      restrictedEmail={invite.email}
      hasExistingAccount={!!existing}
    />
  )
}
