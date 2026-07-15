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
    .select('id, full_name, email, base_role')
    .eq('organization_id', profile.organization_id)
    .order('full_name')

  return (
    <TeamListClient
      organizationId={profile.organization_id}
      invitedBy={user.id}
      members={members || []}
    />
  )
}
