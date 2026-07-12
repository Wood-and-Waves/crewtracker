import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const SUPER_ADMIN_ID = '28d3ae69-15bb-42bc-a478-5d9b43b737de'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user || user.id !== SUPER_ADMIN_ID) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json()
  const { orgName, email } = body

  if (!orgName) {
    return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('invitations')
    .insert({
      email: email || null,
      is_new_organization: true,
      organization_name: orgName,
      base_role: 'admin',
      can_manage_users: true,
      can_manage_billing: true,
      can_manage_crew_directory: true,
      can_import_crew: true,
      can_view_crew_contacts: true,
      can_create_shows: true,
      can_edit_all_shows: true,
      can_archive_shows: true,
      can_duplicate_shows: true,
      can_edit_timecards: true,
      can_approve_timecards: true,
      can_view_pay_rates: true,
      can_edit_pay_rates: true,
      can_manage_rulesets: true,
      can_view_reports: true,
      can_export_reports: true,
      can_send_reports: true,
      view_only: false,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ token: data.token })
}
