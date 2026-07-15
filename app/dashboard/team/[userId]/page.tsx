import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EditMemberClient from '@/components/EditMemberClient'
import { PERMISSION_PRESETS, type Role, type PermissionKey, type PermissionValues } from '@/lib/permissions'

const ALL_KEYS = Object.keys(PERMISSION_PRESETS.admin) as PermissionKey[]

export default async function EditMemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('profiles')
    .select('organization_id, can_manage_users')
    .eq('id', user.id)
    .single()
  if (!me?.can_manage_users || !me.organization_id) redirect('/dashboard')

  // RLS ("Users see profiles in their org") already restricts this to same-org
  // rows; a userId outside the org returns no row.
  const { data: member } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (!member) redirect('/dashboard/team')

  // Build the current values object from the member row.
  const initialValues = {} as PermissionValues
  for (const key of ALL_KEYS) initialValues[key] = member[key] ?? false

  const initialRole: Role =
    member.base_role === 'admin' || member.base_role === 'staff' ? member.base_role : 'pm'

  return (
    <EditMemberClient
      member={{ id: member.id, full_name: member.full_name, email: member.email }}
      initialRole={initialRole}
      initialValues={initialValues}
      isSelf={member.id === user.id}
    />
  )
}
