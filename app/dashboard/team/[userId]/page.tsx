import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import EditMemberClient from '@/components/EditMemberClient'
import { PERMISSION_PRESETS, type Role, type PermissionKey, type PermissionValues } from '@/lib/permissions'

const ALL_KEYS = Object.keys(PERMISSION_PRESETS.admin) as PermissionKey[]

export default async function EditMemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.can('can_manage_users') || !user.organizationId) redirect('/dashboard')

  // Permissions come from the MEMBERSHIP for the organization being administered,
  // not from the profile. The same person can be an admin here and crew
  // elsewhere; editing them must show and change only this organization's side of
  // that. Scoping by organization_id also means an admin cannot reach a member of
  // another company by guessing a URL — RLS refuses, and so does this filter.
  const { data: membership } = await supabase
    .from('memberships')
    .select('*, profiles(id, full_name, email)')
    .eq('profile_id', userId)
    .eq('organization_id', user.organizationId)
    .maybeSingle()
  if (!membership) redirect('/dashboard/team')

  const member = membership as unknown as Record<string, unknown> & {
    profiles: { id: string; full_name: string | null; email: string | null } | null
  }

  const initialValues = {} as PermissionValues
  for (const key of ALL_KEYS) initialValues[key] = (member[key] as boolean) ?? false

  const initialRole: Role =
    member.base_role === 'admin' || member.base_role === 'staff' ? (member.base_role as Role) : 'pm'

  return (
    <EditMemberClient
      member={{
        id: userId,
        full_name: member.profiles?.full_name ?? null,
        email: member.profiles?.email ?? null,
        deactivated_at: (member.deactivated_at as string) ?? null,
      }}
      initialRole={initialRole}
      initialValues={initialValues}
      isSelf={userId === user.id}
    />
  )
}
