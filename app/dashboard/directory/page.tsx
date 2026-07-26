import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CrewDirectoryClient from '@/components/CrewDirectoryClient'

export default async function DirectoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return (
      <div className="p-6 md:p-10">
        <p className="text-muted">No organization linked to this account yet.</p>
      </div>
    )
  }

  // Embed the rate cards WITHOUT day_rate, then merge the rates back in from the
  // permission-checked view. `rate_cards(*)` would send every rate to anyone who
  // can open the Directory.
  const [{ data: crew }, { data: visibleRates }] = await Promise.all([
    supabase
      .from('crew_members')
      .select('*, rate_cards(id, role)')
      .eq('organization_id', profile.organization_id),
    supabase.from('crew_rate_cards_visible').select('id, day_rate'),
  ])

  const rateByCardId = new Map((visibleRates || []).map(r => [r.id, Number(r.day_rate) || 0]))
  const crewWithRates = (crew || []).map((m: any) => ({
    ...m,
    rate_cards: (m.rate_cards || []).map((rc: any) => ({ ...rc, day_rate: rateByCardId.get(rc.id) ?? 0 })),
  }))

  return <CrewDirectoryClient organizationId={profile.organization_id} initialCrew={crewWithRates} />
}
