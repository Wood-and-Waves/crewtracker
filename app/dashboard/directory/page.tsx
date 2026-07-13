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
        <p className="text-zinc-500">No organization linked to this account yet.</p>
      </div>
    )
  }

  const { data: crew } = await supabase
    .from('crew_members')
    .select('*, rate_cards(*)')
    .eq('organization_id', profile.organization_id)

  return <CrewDirectoryClient organizationId={profile.organization_id} initialCrew={crew || []} />
}
