import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PersonalSettingsClient from '@/components/PersonalSettingsClient'
import OrgSettingsClient from '@/components/OrgSettingsClient'
import AVRolesEditor from '@/components/AVRolesEditor'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, use_24_hour_time, shoulder_surfer_mode, can_manage_users')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return (
      <div className="p-6 md:p-10">
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <p className="text-muted">No organization linked to this account yet.</p>
      </div>
    )
  }

  const [{ data: organization }, { data: avRoles }] = await Promise.all([
    supabase.from('organizations').select('id, timecard_rounding_minutes, default_cc_email').eq('id', profile.organization_id).single(),
    supabase.from('av_roles').select('id, name, sort_order').eq('organization_id', profile.organization_id).order('sort_order'),
  ])

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start max-w-4xl">
        <div className="mb-5 lg:mb-0">
          <PersonalSettingsClient
            use24HourTime={profile.use_24_hour_time || false}
            shoulderSurferMode={profile.shoulder_surfer_mode || false}
          />
        </div>

        {profile.can_manage_users && organization && (
          <div className="mb-5 lg:mb-0">
            <OrgSettingsClient
              organizationId={organization.id}
              timecardRoundingMinutes={organization.timecard_rounding_minutes ?? 1}
              defaultCcEmail={organization.default_cc_email}
            />
          </div>
        )}

        {profile.can_manage_users && organization && (
          <div className="lg:col-span-2">
            <AVRolesEditor
              organizationId={profile.organization_id}
              initialRoles={avRoles || []}
            />
          </div>
        )}
      </div>
    </div>
  )
}
