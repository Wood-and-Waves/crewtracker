import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import EditShowClient from '@/components/EditShowClient'
import ShowAccessEditor from '@/components/ShowAccessEditor'
import { fetchLiveTimecards, fetchShowRates, type TimecardRowMaybeRate } from '@/lib/timecardFields'
import { summarizeCall, describeCallSize } from '@/lib/crewCall'

export default async function EditShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // The caller and show/ruleset/workDays are independent of each other (none
  // depend on another's result) so fetch them in one round trip instead
  // of four.
  const [
    user,
    { data: show },
    { data: ruleset },
    { data: workDays },
  ] = await Promise.all([
    getCurrentUser(),
    supabase.from('shows').select('*').eq('id', id).single(),
    supabase.from('payroll_rulesets').select('*').eq('show_id', id).single(),
    supabase.from('work_days').select('*').eq('show_id', id).order('day_number'),
  ])
  if (!user) redirect('/login')

  if (!show) notFound()

  const workDayIds = (workDays || []).map(d => d.id)

  const { data: rooms } = workDayIds.length > 0
    ? await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', workDayIds)
    : { data: [] }

  const roomIds = (rooms || []).map(r => r.id)

  // Crew & Rates is the only consumer and it's hidden without can_view_pay_rates,
  // so don't pull the rate for someone who can't be shown it.
  const canViewRates = user.can('can_view_pay_rates')

  // Declined bookings excluded — the dedupe below keys on (crew|role), so an
  // unreplaced decliner would otherwise appear in Crew & Rates carrying a rate.
  const timecards = await fetchLiveTimecards<TimecardRowMaybeRate>(
    supabase,
    roomIds,
    'id, crew_member_id, crew_member_name, role, room_id',
  )

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

  // Handing off to a scheduler. Moved here from the tracker header (2026-08-06)
  // — it is an admin act on the whole show, not something you do while punching
  // people in. Counted per DAY, never per row: a five-day show needing twelve
  // people has sixty position rows, and "60" is not a number anybody crews
  // against.
  const schedulingOn = canUseScheduling(user)

  const [{ data: positionRows }, { data: scheduler }] = schedulingOn
    ? await Promise.all([
        supabase
          .from('crew_call_positions')
          .select('id, rooms!inner(work_days!inner(date, show_id))')
          .eq('rooms.work_days.show_id', id),
        show.scheduler_id
          ? supabase.from('profiles').select('full_name, email').eq('id', show.scheduler_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
    : [{ data: null }, { data: null }]

  const callSummary = summarizeCall((positionRows ?? []).map((p: any) => {
    const room = Array.isArray(p.rooms) ? p.rooms[0] : p.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    return { date: wd?.date }
  }).filter((r: any) => r.date))

  // Show Access — only fetched for admins, since only they can change it and
  // the member list is otherwise none of a PM's business.
  const canManageUsers = user.can('can_manage_users')
  const [{ data: orgMembers }, { data: assignments }] = canManageUsers
    ? await Promise.all([
        // From memberships, for the same reason as the team list: a person who
        // works for two production companies has one profile whose legacy
        // organization_id names only one of them, so listing by that column
        // would omit them from the other company's Show Access panel.
        supabase
          .from('memberships')
          .select('profile_id, base_role, can_edit_all_shows, profiles(id, full_name, email)')
          .eq('organization_id', user.organizationId)
          .is('deactivated_at', null),
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
      shoulderSurferMode={user.shoulderSurfer}
      organizationId={user.organizationId || undefined}
      canManageRulesets={user.can('can_manage_rulesets')}
      canViewRates={canViewRates}
      canEditRates={user.can('can_edit_pay_rates')}
      // Omitted entirely when the module is off — EditShowClient renders the
      // Scheduling section only when this prop is present.
      scheduling={schedulingOn ? {
        schedulerName: (scheduler as any)?.full_name || (scheduler as any)?.email || null,
        positionCount: callSummary.total,
        callSize: describeCallSize(callSummary),
      } : undefined}
    >
      {canManageUsers && (
        <div className="mb-4">
          <ShowAccessEditor
            showId={show.id}
            members={((orgMembers ?? []) as unknown as {
              profile_id: string
              base_role: string | null
              can_edit_all_shows: boolean | null
              profiles: { id: string; full_name: string | null; email: string | null } | null
            }[])
              .filter(m => m.profiles)
              .map(m => ({
                id: m.profile_id,
                full_name: m.profiles!.full_name,
                email: m.profiles!.email,
                base_role: m.base_role,
                can_edit_all_shows: m.can_edit_all_shows ?? false,
              }))
              .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''))}
            initialAssignedIds={(assignments || []).map(a => a.profile_id)}
            createdBy={show.created_by}
          />
        </div>
      )}
    </EditShowClient>
  )
}
