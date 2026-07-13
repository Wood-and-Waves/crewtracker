import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import EditCrewMemberClient from '@/components/EditCrewMemberClient'

export default async function EditCrewMemberPage({ params }: { params: Promise<{ crewId: string }> }) {
  const { crewId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  const { data: crew } = await supabase
    .from('crew_members')
    .select('*, rate_cards(*)')
    .eq('id', crewId)
    .single()

  if (!crew) notFound()

  const { data: roles } = await supabase
    .from('av_roles')
    .select('*')
    .eq('organization_id', profile?.organization_id)
    .order('sort_order')

  return <EditCrewMemberClient crew={crew} availableRoles={roles || []} />
}
