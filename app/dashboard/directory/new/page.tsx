import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import NewCrewMemberClient from '@/components/NewCrewMemberClient'

export default async function NewCrewMemberPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.organizationId) redirect('/dashboard/directory')

  const { data: roles } = await supabase
    .from('av_roles')
    .select('id, name')
    .eq('organization_id', user.organizationId)
    // Alphabetical everywhere; sort_order is no longer user-managed.
    .order('name')

  return (
    <NewCrewMemberClient
      organizationId={user.organizationId}
      availableRoles={roles || []}
      canEditRates={user.can('can_edit_pay_rates')}
    />
  )
}
