import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TeamListClient from '@/components/TeamListClient'

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, can_manage_users')
    .eq('id', user.id)
    .single()

  if (!profile?.can_manage_users || !profile.organization_id) redirect('/dashboard')

  const { data: members } = await supabase
    .from('profiles')
    // Removed members are still listed, greyed and last, so an admin can find
    // them to restore. Their row is kept on purpose — see
    // scripts/sql/applied/deactivate-team-members.sql.
    .select('id, full_name, email, base_role, deactivated_at')
    .eq('organization_id', profile.organization_id)
    .order('deactivated_at', { ascending: true, nullsFirst: true })
    .order('full_name')

  return (
    <TeamListClient
      organizationId={profile.organization_id}
      invitedBy={user.id}
      members={members || []}
    />
  )
}
