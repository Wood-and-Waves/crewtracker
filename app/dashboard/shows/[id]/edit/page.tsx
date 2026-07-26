import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import EditShowClient from '@/components/EditShowClient'
import ShowAccessEditor from '@/components/ShowAccessEditor'
import { fetchShowRates, type TimecardRowMaybeRate } from '@/lib/timecardFields'

export default async function EditShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // profile/show/ruleset/workDays are independent of each other (none
  // depend on another's result) so fetch them in one round trip instead
  // of four.
  const [
    { data: profile },
    { data: show },
    { data: ruleset },
    { data: workDays },
  ] = await Promise.all([
    supabase.from('profiles').select('organization_id, shoulder_surfer_mode, can_manage_rulesets, can_manage_users, can_view_pay_rates, can_edit_pay_rates').eq('id', user.id).single(),
    supabase.from('shows').select('*').eq('id', id).single(),
    supabase.from('payroll_rulesets').select('*').eq('show_id', id).single(),
    supabase.from('work_days').select('*').eq('show_id', id).order('day_number'),
  ])

  if (!show) notFound()

  const workDayIds = (workDays || []).map(d => d.id)

  const { data: rooms } = workDayIds.length > 0
    ? await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', workDayIds)
    : { data: [] }

  const roomIds = (rooms || []).map(r => r.id)

  // Crew & Rates is the only consumer and it's hidden without can_view_pay_rates,
  // so don't pull the rate for someone who can't be shown it.
  const canViewRates = profile?.can_view_pay_rates || false

  const { data: timecardRows } = roomIds.length > 0
    ? await supabase.from('timecards').select('id, crew_member_id, crew_member_name, role, room_id').in('room_id', roomIds)
    : { data: [] }
  const timecards = (timecardRows || []) as unknown as TimecardRowMaybeRate[]

  // Rates via the permission-checked view — empty for a user without
  // can_view_pay_rates, which is also when Crew & Rates is hidden entirely.
  const rateById = await fetchShowRates(supabase, id)

  // Dedupe to unique (crew, role) combos, matching iOS crewRateEntries logic
  const seen: Record<string, any> = {}
  for (const tc of timecards || []) {
    const key = (tc.crew_member_id || tc.crew_member_name) + '|' + tc.role
    if (!seen[key]) {
      seen[key] = { crewMemberId: tc.crew_member_id, name: tc.crew_member_name, role: tc.role, dayRate: rateById.get(tc.id) ?? 0 }
    }
  }
  const crewRateEntries = Object.values(seen).sort((a: any, b: any) => a.name.localeCompare(b.name))

  // Show Access — only fetched for admins, since only they can change it and
  // the member list is otherwise none of a PM's business.
  const canManageUsers = profile?.can_manage_users || false
  const [{ data: orgMembers }, { data: assignments }] = canManageUsers
    ? await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, base_role, can_edit_all_shows')
          .eq('organization_id', profile!.organization_id)
          .order('full_name'),
        supabase.from('show_assignments').select('profile_id').eq('show_id', id),
      ])
    : [{ data: null }, { data: null }]

  return (
    <EditShowClient
      show={show}
      ruleset={ruleset}
      workDays={workDays || []}
      rooms={rooms || []}
      crewRateEntries={crewRateEntries}
      shoulderSurferMode={profile?.shoulder_surfer_mode || false}
      organizationId={profile?.organization_id || undefined}
      canManageRulesets={profile?.can_manage_rulesets || false}
      canViewRates={canViewRates}
      canEditRates={profile?.can_edit_pay_rates || false}
    >
      {canManageUsers && (
        <div className="mb-4">
          <ShowAccessEditor
            showId={show.id}
            members={orgMembers || []}
            initialAssignedIds={(assignments || []).map(a => a.profile_id)}
            createdBy={show.created_by}
          />
        </div>
      )}
    </EditShowClient>
  )
}
