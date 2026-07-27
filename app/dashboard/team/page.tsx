import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import TeamListClient from '@/components/TeamListClient'

export default async function TeamPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.can('can_manage_users') || !user.organizationId) redirect('/dashboard')

  const { data: members } = await supabase
    .from('profiles')
    // Removed members are still listed, greyed and last, so an admin can find
    // them to restore. Their row is kept on purpose — see
    // scripts/sql/applied/deactivate-team-members.sql.
    .select('id, full_name, email, base_role, deactivated_at')
    .eq('organization_id', user.organizationId)
    .order('deactivated_at', { ascending: true, nullsFirst: true })
    .order('full_name')

  return (
    <TeamListClient
      organizationId={user.organizationId}
      invitedBy={user.id}
      members={members || []}
    />
  )
}
