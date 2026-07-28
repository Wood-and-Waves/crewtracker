import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import TeamListClient from '@/components/TeamListClient'

export default async function TeamPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.can('can_manage_users') || !user.organizationId) redirect('/dashboard')

  // Listed from MEMBERSHIPS, not profiles. Someone who works for two production
  // companies has one profile whose legacy organization_id can only name one of
  // them — listing by that column would silently omit them from the other
  // company's team page. Membership is the thing that means "in this org".
  //
  // Removed members are still listed, greyed and last, so an admin can find them
  // to restore. Their row is kept on purpose — see
  // scripts/sql/applied/deactivate-team-members.sql.
  const { data: rows } = await supabase
    .from('memberships')
    .select('profile_id, base_role, deactivated_at, profiles(id, full_name, email)')
    .eq('organization_id', user.organizationId)
    .order('deactivated_at', { ascending: true, nullsFirst: true })

  type MemberRow = {
    profile_id: string
    base_role: string | null
    deactivated_at: string | null
    profiles: { id: string; full_name: string | null; email: string | null } | null
  }

  const members = ((rows ?? []) as unknown as MemberRow[])
    .map((r) => ({
      id: r.profile_id,
      full_name: r.profiles?.full_name ?? null,
      email: r.profiles?.email ?? null,
      base_role: r.base_role,
      deactivated_at: r.deactivated_at,
    }))
    // Sorted here rather than in the query: the name lives on the joined profile,
    // and PostgREST cannot order by an embedded column reliably.
    .sort((a, b) =>
      Number(!!a.deactivated_at) - Number(!!b.deactivated_at) ||
      (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''),
    )

  return (
    <TeamListClient
      organizationId={user.organizationId}
      invitedBy={user.id}
      members={members}
    />
  )
}
