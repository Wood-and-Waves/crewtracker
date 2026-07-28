import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import EditCrewMemberClient from '@/components/EditCrewMemberClient'

export default async function EditCrewMemberPage({ params }: { params: Promise<{ crewId: string }> }) {
  const { crewId } = await params
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Rate cards without day_rate; the rates come from the permission-checked
  // view, so a user without can_view_pay_rates simply gets zeros.
  const [{ data: crewRow }, { data: visibleRates }] = await Promise.all([
    supabase
      .from('crew_members')
      .select('*, rate_cards(id, role)')
      .eq('id', crewId)
      .single(),
    supabase.from('crew_rate_cards_visible').select('id, day_rate').eq('crew_member_id', crewId),
  ])

  if (!crewRow) notFound()

  const rateByCardId = new Map((visibleRates || []).map(r => [r.id, Number(r.day_rate) || 0]))
  const crew = {
    ...crewRow,
    rate_cards: ((crewRow as any).rate_cards || []).map((rc: any) => ({
      ...rc,
      day_rate: rateByCardId.get(rc.id) ?? 0,
    })),
  }

  const { data: roles } = await supabase
    .from('av_roles')
    .select('*')
    .eq('organization_id', user?.organizationId)
    // Alphabetical everywhere; sort_order is no longer user-managed.
    .order('name')

  return (
    <EditCrewMemberClient
      crew={crew}
      availableRoles={roles || []}
      shoulderSurferMode={user?.shoulderSurfer ?? false}
      canViewRates={user?.can('can_view_pay_rates') ?? false}
      canEditRates={user?.can('can_edit_pay_rates') ?? false}
    />
  )
}
