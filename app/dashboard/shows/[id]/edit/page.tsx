import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling, isPmOnShow } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import EditShowClient from '@/components/EditShowClient'
import ShowAccessEditor from '@/components/ShowAccessEditor'
import CrewClockPanel from '@/components/CrewClockPanel'
import { fetchLiveTimecards, fetchShowRates, type TimecardRowMaybeRate } from '@/lib/timecardFields'
import { summarizeCall, describeCallSize } from '@/lib/crewCall'

export default async function EditShowPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ handoff?: string }>
}) {
  const { id } = await params
  // "Create show and send to scheduler" lands here with ?handoff=1.
  const { handoff } = await searchParams
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
  // Crew-side viewers have their own screen; everything else on the show
  // belongs to the PM (Section 3, 2026-09-06).
  if (!(await isPmOnShow(supabase, id))) redirect(`/dashboard/shows/${id}`)

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
  // Rates via the permission-checked view. Gated on the permission here as well
  // as in the view: without it the view still ran its four-table join for a
  // user whose Crew & Rates section is hidden anyway. Independent of the
  // timecards read, so the two share a round trip.
  const [timecards, rateById] = await Promise.all([
    fetchLiveTimecards<TimecardRowMaybeRate>(
      supabase,
      roomIds,
      'id, crew_member_id, crew_member_name, role, room_id',
    ),
    canViewRates ? fetchShowRates(supabase, id) : Promise.resolve(new Map<string, number>()),
  ])

  // Dedupe to unique (crew, role) combos, matching iOS crewRateEntries logic
  const seen: Record<string, any> = {}
  for (const tc of timecards || []) {
    const key = (tc.crew_member_id || tc.crew_member_name) + '|' + tc.role
    if (!seen[key]) {
      seen[key] = { crewMemberId: tc.crew_member_id, name: tc.crew_member_name, role: tc.role, dayRate: rateById.get(tc.id) ?? 0 }
    }
  }
  const crewRateEntries = Object.values(seen).sort((a: any, b: any) => a.name.localeCompare(b.name))

  // Crew Clock — one entry per PERSON, not per person+role like Crew & Rates
  // above: a clock link belongs to a human, not to a job title, and somebody
  // holding two roles on a show still punches once.
  //
  // crew_member_id is nullable, and lib/crew.ts nulls it before deleting a
  // crew member, so historical rows can carry a name with no FK. A personal
  // link needs the FK, so those people are simply absent here and fall back to
  // the venue QR.
  const canEditTimecards = user.can('can_edit_timecards')
  const clockSeen = new Set<string>()
  const clockCrew: { crewMemberId: string; name: string }[] = []
  for (const tc of timecards || []) {
    if (!tc.crew_member_id || clockSeen.has(tc.crew_member_id)) continue
    clockSeen.add(tc.crew_member_id)
    clockCrew.push({ crewMemberId: tc.crew_member_id, name: tc.crew_member_name || 'Unnamed' })
  }
  clockCrew.sort((a, b) => a.name.localeCompare(b.name))

  const { data: clockLinks } = canEditTimecards
    ? await supabase.from('clock_links').select('id, crew_member_id, token, revoked_at').eq('show_id', id)
    : { data: [] }

  // Sending to scheduling. Moved here from the tracker header (2026-08-06) —
  // it is an admin act on the whole show, not something you do while punching
  // people in. Counted per DAY, never per row: a five-day show needing twelve
  // people has sixty position rows, and "60" is not a number anybody crews
  // against.
  const schedulingOn = canUseScheduling(user)

  const { data: positionRows } = schedulingOn
    ? await supabase
        .from('crew_call_positions')
        .select('id, rooms!inner(work_days!inner(date, show_id))')
        .eq('rooms.work_days.show_id', id)
    : { data: null }

  // Positions by kind (piece B): the definitions, the flags, and the role list
  // for the editor. Only with the scheduling module, like the slots above.
  const [{ data: positionDefs }, { data: slotFlags }, { data: avRoles }] = schedulingOn
    ? await Promise.all([
        supabase.from('position_defs').select('id, room_name, role, count, day_kind, custom_dates, sort_order').eq('show_id', id).order('sort_order'),
        supabase.from('position_slot_flags').select('slot_id, position_def_id, room_name, date, role, timecard_id, crew_member_name').eq('show_id', id).order('date'),
        supabase.from('av_roles').select('name').eq('organization_id', user.organizationId!).order('name'),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  // The named PM (piece B). Their name comes from profiles, in-org readable.
  const { data: pmProfile } = show.pm_profile_id
    ? await supabase.from('profiles').select('full_name, email').eq('id', show.pm_profile_id).maybeSingle()
    : { data: null }
  const pmState = {
    profileId: (show.pm_profile_id as string | null) ?? null,
    name: ((pmProfile as any)?.full_name || (pmProfile as any)?.email || null) as string | null,
    invitedAt: (show.pm_invited_at as string | null) ?? null,
    acceptedAt: (show.pm_accepted_at as string | null) ?? null,
  }

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
        sentAt: show.sent_to_scheduling_at ?? null,
        positionCount: callSummary.total,
        callSize: describeCallSize(callSummary),
        openHandoff: handoff === '1',
      } : undefined}
      pm={pmState}
      positions={schedulingOn ? {
        defs: (positionDefs ?? []) as any[],
        flags: (slotFlags ?? []) as any[],
        roles: (avRoles ?? []).map((r: any) => r.name as string),
      } : undefined}
    >
      {canEditTimecards && (
        <CrewClockPanel
          showId={show.id}
          showName={show.name}
          showEndDate={show.end_date}
          timeZone={show.timezone_identifier || 'America/Chicago'}
          organizationId={user.organizationId!}
          createdBy={user.id}
          crew={clockCrew}
          initialLinks={clockLinks || []}
        />
      )}

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
