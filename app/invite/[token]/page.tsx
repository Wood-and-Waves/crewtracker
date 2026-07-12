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
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Invalid Invite</h1>
          <p className="text-zinc-400 text-sm">This invite link doesn't exist.</p>
        </div>
      </div>
    )
  }

  if (invite.accepted_at) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Invite Already Used</h1>
          <p className="text-zinc-400 text-sm">This invite link has already been accepted.</p>
        </div>
      </div>
    )
  }

  if (new Date(invite.expires_at) < new Date()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Invite Expired</h1>
          <p className="text-zinc-400 text-sm">This invite link has expired. Ask for a new one.</p>
        </div>
      </div>
    )
  }

  return (
    <InviteAuthForm
      token={token}
      orgName={invite.organization_name}
      isNewOrg={invite.is_new_organization}
      restrictedEmail={invite.email}
    />
  )
}
