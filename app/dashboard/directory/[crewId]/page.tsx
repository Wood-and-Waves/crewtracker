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
    .select('organization_id, shoulder_surfer_mode')
    .eq('id', user.id)
    .single()

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
    .eq('organization_id', profile?.organization_id)
    .order('sort_order')

  return (
    <EditCrewMemberClient
      crew={crew}
      availableRoles={roles || []}
      shoulderSurferMode={profile?.shoulder_surfer_mode || false}
    />
  )
}
