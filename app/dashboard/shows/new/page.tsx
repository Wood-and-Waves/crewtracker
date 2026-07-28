import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import Card from '@/components/ui/Card'
import NewShowClient from '@/components/NewShowClient'

// Creating a show is a page, not a dialog — see the header of NewShowClient for
// why. Roles and payroll presets are fetched here rather than in a client
// effect, so the form is complete in the first render instead of popping its
// dropdowns in a moment later.

export default async function NewShowPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  if (!user.organizationId) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-8">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="mb-2 text-2xl font-bold text-ink">Almost there</h1>
          <p className="text-sm text-muted">Your account isn&apos;t linked to an organization yet.</p>
        </Card>
      </div>
    )
  }

  const [{ data: roleRows }, { data: presets }] = await Promise.all([
    supabase.from('av_roles').select('name').order('sort_order'),
    supabase.from('payroll_presets').select('*').eq('organization_id', user.organizationId).order('sort_order'),
  ])

  return (
    <NewShowClient
      organizationId={user.organizationId}
      roles={(roleRows ?? []).map(r => r.name)}
      presets={(presets ?? []) as any}
    />
  )
}
