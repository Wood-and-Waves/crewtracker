import { createAdminClient } from '@/lib/supabase/admin'

export async function acceptInvite(token: string, userId: string) {
  const admin = createAdminClient()

  const { data: invite, error: inviteError } = await admin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .single()

  if (inviteError || !invite) return { error: 'Invalid invite link' }
  if (invite.accepted_at) return { error: 'This invite has already been used' }
  if (new Date(invite.expires_at) < new Date()) return { error: 'This invite has expired' }

  let organizationId = invite.organization_id

  if (invite.is_new_organization) {
    const { data: org, error: orgError } = await admin
      .from('organizations')
      .insert({ name: invite.organization_name })
      .select()
      .single()

    if (orgError || !org) return { error: 'Failed to create organization' }
    organizationId = org.id
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      organization_id: organizationId,
      base_role: invite.base_role,
      can_manage_users: invite.can_manage_users,
      can_manage_billing: invite.can_manage_billing,
      can_manage_crew_directory: invite.can_manage_crew_directory,
      can_import_crew: invite.can_import_crew,
      can_view_crew_contacts: invite.can_view_crew_contacts,
      can_create_shows: invite.can_create_shows,
      can_edit_all_shows: invite.can_edit_all_shows,
      can_archive_shows: invite.can_archive_shows,
      can_duplicate_shows: invite.can_duplicate_shows,
      can_edit_timecards: invite.can_edit_timecards,
      can_approve_timecards: invite.can_approve_timecards,
      can_view_pay_rates: invite.can_view_pay_rates,
      can_edit_pay_rates: invite.can_edit_pay_rates,
      can_manage_rulesets: invite.can_manage_rulesets,
      can_view_reports: invite.can_view_reports,
      can_export_reports: invite.can_export_reports,
      can_send_reports: invite.can_send_reports,
      view_only: invite.view_only,
    })
    .eq('id', userId)

  if (profileError) return { error: 'Failed to update profile' }

  await admin
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('token', token)

  return { success: true }
}
