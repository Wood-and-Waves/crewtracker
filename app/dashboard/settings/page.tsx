import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, getMyOrganizations } from '@/lib/session'
import { redirect } from 'next/navigation'
import OrgSwitcherCard from '@/components/OrgSwitcherCard'
import PersonalSettingsClient from '@/components/PersonalSettingsClient'
import OrgSettingsClient from '@/components/OrgSettingsClient'
import AVRolesEditor from '@/components/AVRolesEditor'
import PayrollPresetsEditor from '@/components/PayrollPresetsEditor'

export default async function SettingsPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  const organizations = await getMyOrganizations()
  if (!user) redirect('/login')

  if (!user.organizationId) {
    return (
      <div className="p-6 md:p-10">
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <p className="text-muted">No organization linked to this account yet.</p>
      </div>
    )
  }

  const [{ data: organization }, { data: avRoles }, { data: presets }] = await Promise.all([
    supabase.from('organizations').select('id, timecard_rounding_minutes, final_report_emails').eq('id', user.organizationId).single(),
    supabase.from('av_roles').select('id, name, sort_order').eq('organization_id', user.organizationId).order('name'),
    supabase.from('payroll_presets').select('*').eq('organization_id', user.organizationId).order('sort_order'),
  ])

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start max-w-4xl">
        <div className="mb-5 lg:mb-0">
          {/* Renders nothing below two companies. This is the ONLY switcher on
              mobile — AppShell's account menu is desktop-only. */}
          {organizations.length > 1 && (
            <div className="mb-5">
              <OrgSwitcherCard organizations={organizations} userId={user.id} />
            </div>
          )}
          <PersonalSettingsClient
            use24HourTime={user.use24Hour}
            shoulderSurferMode={user.shoulderSurfer}
            fullName={user.fullName || ''}
          />
        </div>

        {user.can('can_manage_users') && organization && (
          <div className="mb-5 lg:mb-0">
            <OrgSettingsClient
              organizationId={organization.id}
              timecardRoundingMinutes={organization.timecard_rounding_minutes ?? 1}
              finalReportEmails={organization.final_report_emails}
            />
          </div>
        )}

        {user.can('can_manage_users') && organization && (
          <div className="lg:col-span-2 mb-5">
            <AVRolesEditor
              organizationId={user.organizationId}
              initialRoles={avRoles || []}
            />
          </div>
        )}

        {user.can('can_manage_rulesets') && (
          <div className="lg:col-span-2">
            <PayrollPresetsEditor
              organizationId={user.organizationId}
              initialPresets={(presets || []) as any}
            />
          </div>
        )}
      </div>
    </div>
  )
}
