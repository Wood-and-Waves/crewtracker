import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { notFound, redirect } from 'next/navigation'
import ImportShowClient from '@/components/ImportShowClient'

// Import a whole show from a CSV (2026-11-06). The planner is pure
// (lib/showImport.ts); this page only gathers what it needs to judge the file —
// the org's presets, roles and crew names — so the preview can say what is new
// before anything is written. Same gate as New Show: can_create_shows.

export default async function ImportShowPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.organizationId || !user.can('can_create_shows')) notFound()

  const [{ data: roleRows }, { data: presets }, { data: crewRows }] = await Promise.all([
    supabase.from('av_roles').select('name').eq('organization_id', user.organizationId).order('name'),
    supabase.from('payroll_presets').select('*').eq('organization_id', user.organizationId).order('sort_order'),
    supabase.from('crew_members').select('full_name').eq('organization_id', user.organizationId),
  ])

  return (
    <ImportShowClient
      organizationId={user.organizationId}
      userId={user.id}
      roles={(roleRows ?? []).map(r => r.name)}
      presets={(presets ?? []) as any}
      crewNames={(crewRows ?? []).map(c => c.full_name)}
      canManageCrew={user.can('can_manage_crew_directory')}
      canEditRates={user.can('can_edit_pay_rates')}
    />
  )
}
