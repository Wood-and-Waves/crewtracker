import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getSuperAdminId } from '@/lib/superadmin'
import { redirect } from 'next/navigation'
import SuperAdminClient, { type OrgRow, type InviteRow } from '@/components/SuperAdminClient'

// Platform operator view. Everything below runs with the SERVICE ROLE, which
// bypasses row-level security completely — the getSuperAdminId check is the
// only thing protecting every organization's data, so it comes first and
// redirects rather than rendering anything.
//
// Deliberately does NOT load profiles. The previous version listed every user
// on the platform with their name, email, org and role; seat counts give the
// same operational picture without the customer's member directory.

export default async function SuperAdminPage() {
  const supabase = await createClient()
  if (!(await getSuperAdminId(supabase as any))) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()

  const [{ data: orgs }, { data: subs }, { data: memberOrgIds }, { data: showOrgIds }, { data: invites }] =
    await Promise.all([
      admin.from('organizations').select('id, name, created_at, disabled_at, scheduling_enabled').order('created_at', { ascending: false }),
      admin.from('subscriptions').select('organization_id, plan, status, trial_ends_at'),
      // organization_id only — counting members must not mean reading them.
      //
      // From memberships, not profiles: membership IS what "in this org" means
      // now, and profiles.organization_id is being dropped. It is also simply
      // more correct — one person working for two companies is a seat at each,
      // which the old single column could not express.
      //
      // Deactivated members are excluded: they cannot sign in, so counting them
      // would overstate every organization's seats on this screen.
      admin.from('memberships').select('organization_id').is('deactivated_at', null),
      admin.from('shows').select('organization_id'),
      admin.from('invitations').select('*, organizations(name)').is('accepted_at', null).order('created_at', { ascending: false }),
    ])

  const countBy = (rows: { organization_id: string | null }[] | null) => {
    const m = new Map<string, number>()
    for (const r of rows || []) {
      if (r.organization_id) m.set(r.organization_id, (m.get(r.organization_id) || 0) + 1)
    }
    return m
  }
  const memberCounts = countBy(memberOrgIds)
  const showCounts = countBy(showOrgIds)
  const subByOrg = new Map((subs || []).map(s => [s.organization_id, s]))

  const orgRows: OrgRow[] = (orgs || []).map(o => {
    const sub = subByOrg.get(o.id)
    return {
      id: o.id,
      name: o.name,
      created_at: o.created_at,
      disabled_at: o.disabled_at,
      schedulingEnabled: o.scheduling_enabled !== false,
      plan: sub?.plan ?? null,
      status: sub?.status ?? null,
      trialEndsAt: sub?.trial_ends_at ?? null,
      members: memberCounts.get(o.id) || 0,
      shows: showCounts.get(o.id) || 0,
    }
  })

  const now = Date.now()
  const inviteRows: InviteRow[] = (invites || []).map((i: any) => ({
    id: i.id,
    email: i.email,
    // A new-org invite has no organization yet, so it carries the intended name
    // on the invitation itself.
    orgLabel: i.is_new_organization
      ? (i.organization_name || 'New organization')
      : (i.organizations?.name || 'Unknown organization'),
    isNewOrg: !!i.is_new_organization,
    expires_at: i.expires_at,
    expired: new Date(i.expires_at).getTime() < now,
  }))

  return <SuperAdminClient orgs={orgRows} invites={inviteRows} />
}
