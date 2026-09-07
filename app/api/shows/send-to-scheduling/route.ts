import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendCallHandoffEmail } from '@/lib/callHandoffEmail'
import { summarizeCall, describeCallSize } from '@/lib/crewCall'
import { siteOrigin } from '@/lib/siteOrigin'

// Send a show to scheduling — to EVERYONE with the permission — or take it back.
//
// AUTHORIZATION IS THE shows UPDATE POLICY: the stamp is written through the
// caller's session as a verified update. The service role is used only to
// read the recipient list afterwards (memberships of other people), never to
// decide anything.
//
// Nobody owns a sent show. scheduler_id / call_approved_at are history and
// are not written here.

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!canUseScheduling(user)) {
    return NextResponse.json({ error: 'Scheduling is not enabled for this account.' }, { status: 403 })
  }

  let showId: string | undefined
  let takeBack: boolean | undefined
  try { ({ showId, takeBack } = await request.json()) } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!showId) return NextResponse.json({ error: 'Missing showId.' }, { status: 400 })

  const { data: show } = await supabase
    .from('shows')
    .select('id, name, venue, start_date, end_date, organization_id, sent_to_scheduling_at, finalized_at')
    .eq('id', showId).maybeSingle()
  if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 })
  if (show.finalized_at) return NextResponse.json({ error: 'This show has been closed out.' }, { status: 400 })

  const now = new Date().toISOString()

  if (takeBack) {
    if (!show.sent_to_scheduling_at) return NextResponse.json({ error: 'This show is not with scheduling.' }, { status: 400 })
    const { data: back } = await supabase.from('shows')
      .update({ sent_to_scheduling_at: null, sent_to_scheduling_by: null }).eq('id', show.id).select('id')
    if (!back?.length) return NextResponse.json({ error: 'You do not have permission to change this show.' }, { status: 403 })
    return NextResponse.json({ ok: true, sentTo: 0 })
  }

  if (show.sent_to_scheduling_at) return NextResponse.json({ error: 'This show is already with scheduling.' }, { status: 400 })

  // Something to schedule. Counted per day, never per row (lib/crewCall.ts).
  const { data: positionRows } = await supabase
    .from('crew_call_positions')
    .select('id, rooms!inner(work_days!inner(date, show_id))')
    .eq('rooms.work_days.show_id', showId)
  const call = summarizeCall((positionRows ?? []).map((p: any) => {
    const room = Array.isArray(p.rooms) ? p.rooms[0] : p.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    return { date: wd?.date }
  }).filter((r: any) => r.date))
  if (!call.total) return NextResponse.json({ error: 'Add at least one position before sending this show to scheduling.' }, { status: 400 })

  const { data: updated, error: updateError } = await supabase.from('shows')
    .update({ sent_to_scheduling_at: now, sent_to_scheduling_by: user.id }).eq('id', show.id).select('id')
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })
  if (!updated?.length) return NextResponse.json({ error: 'You do not have permission to send this show.' }, { status: 403 })

  // Everyone with the permission, in THIS company, live. Read with the
  // service role: the caller may not hold can_manage_users, and this is a
  // notification list, not a decision.
  const admin = createAdminClient()
  const [{ data: schedulers }, { data: org }] = await Promise.all([
    admin.from('memberships').select('profile_id, profiles(full_name, email)')
      .eq('organization_id', show.organization_id).eq('can_manage_scheduling', true).is('deactivated_at', null),
    admin.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
  ])
  const recipients = ((schedulers ?? []) as any[]).map(m => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    return { name: (p?.full_name ?? null) as string | null, email: (p?.email ?? null) as string | null }
  }).filter(r => r.email)
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, sentTo: 0, warning: 'Sent, but nobody in this company has the scheduling permission yet, so no email went out.' })
  }

  const origin = siteOrigin()
  const failures: string[] = []
  for (const r of recipients) {
    const result = await sendCallHandoffEmail({
      to: r.email!, recipientName: r.name, showName: show.name, venue: show.venue,
      startDate: show.start_date, endDate: show.end_date,
      organizationName: org?.name ?? 'your team', sentByName: user.fullName,
      callSize: describeCallSize(call), link: `${origin}/dashboard/shows/${show.id}`,
    })
    if (result.error) failures.push(r.email!)
  }
  if (failures.length) {
    return NextResponse.json({ ok: true, sentTo: recipients.length - failures.length, warning: `Sent, but the email did not reach ${failures.join(', ')}.` })
  }
  return NextResponse.json({ ok: true, sentTo: recipients.length })
}
