import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, getMyOrganizations } from '@/lib/session'
import { redirect } from 'next/navigation'
import OrgSwitcherCard from '@/components/OrgSwitcherCard'
import SettingsLayout, { type SettingsSection } from '@/components/SettingsLayout'
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

  const sections: SettingsSection[] = [
    {
      id: 'personal',
      label: 'Personal',
      description: 'Only affects your account on this device.',
      node: (
        <PersonalSettingsClient
          use24HourTime={user.use24Hour}
          shoulderSurferMode={user.shoulderSurfer}
          fullName={user.fullName || ''}
        />
      ),
    },
  ]

  if (user.can('can_manage_users') && organization) {
    sections.push({
      id: 'organization',
      label: 'Organization',
      description: 'Applies to everyone in your organization.',
      node: (
        <OrgSettingsClient
          organizationId={organization.id}
          timecardRoundingMinutes={organization.timecard_rounding_minutes ?? 1}
          finalReportEmails={organization.final_report_emails}
        />
      ),
    })
    sections.push({
      id: 'roles',
      label: 'AV roles',
      description: 'The job titles available when staffing crew.',
      node: <AVRolesEditor organizationId={user.organizationId} initialRoles={avRoles || []} />,
    })
  }

  if (user.can('can_manage_rulesets')) {
    sections.push({
      id: 'presets',
      label: 'Payroll presets',
      description: 'Named rule sets, copied into a show when it is created.',
      node: <PayrollPresetsEditor organizationId={user.organizationId} initialPresets={(presets || []) as any} />,
    })
  }

  // Below two companies there is nothing to switch between. This is also the
  // ONLY switcher on mobile — AppShell's account menu is desktop-only — so it
  // cannot simply move into that menu.
  if (organizations.length > 1) {
    sections.push({
      id: 'companies',
      label: 'Companies',
      description: 'Switch which company you are working in.',
      node: <OrgSwitcherCard organizations={organizations} userId={user.id} />,
    })
  }

  return (
    <div className="p-6 md:p-10">
      <h1 className="mb-6 text-3xl font-extrabold tracking-tight">Settings</h1>
      {/* One bordered surface around the whole screen, the same as the table on
          Shows, Directory and Team and the grid on Schedule. Settings was the
          only nav destination whose content sat bare on the page background,
          which read as an unfinished page rather than a deliberate one.
          This is not the card retirement coming back: what is going is the
          ragged grid of differently-sized cards, not a single container that
          gives a screen its edge. */}
      <div className="rounded-card border border-line bg-surface p-4 md:p-6">
        <SettingsLayout sections={sections} />
      </div>
    </div>
  )
}
