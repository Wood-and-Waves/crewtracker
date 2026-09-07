import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { sendDaysChangedEmail } from '@/lib/daysChangedEmail'
import type { EngagementDay } from '@/lib/bookingEmail'

// Telling crew whose days on a show changed. Offered, never forced — see
// components/CrewChangeNotice.tsx, which posts here after a position move, a
// release, a room removal, or an Add-Day extension.
//
// AUTHORIZATION IS THE RLS POLICY. The show and the crew members are read
// through the CALLER's session, so if either comes back they are entitled to
// it — same shape as app/api/bookings/send. No write happens here; this only
// reads and emails, so there is nothing for the service role to do.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Same gate as every scheduling-module write: hiding the button is
  // tidiness, this is the boundary.
  if (!canUseScheduling(await getCurrentUser())) {
    return NextResponse.json(
      { error: 'Scheduling is not enabled for this account.' },
      { status: 403 },
    )
  }

  let showId: string | undefined
  let crewMemberIds: string[] | undefined
  try {
    ({ showId, crewMemberIds } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!showId || !Array.isArray(crewMemberIds) || crewMemberIds.length === 0) {
    return NextResponse.json({ error: 'Missing showId or crewMemberIds.' }, { status: 400 })
  }

  const [{ data: show }, { data: crew }] = await Promise.all([
    supabase.from('shows').select('id, name, venue, organization_id').eq('id', showId).maybeSingle(),
    supabase.from('crew_members').select('id, full_name, email').in('id', crewMemberIds),
  ])
  if (!show || !crew?.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const { data: org } = await supabase
    .from('organizations').select('name').eq('id', show.organization_id).maybeSingle()

  // Their current days on this show, read as the caller. Built the same way
  // app/api/bookings/send does it, extended to several people at once: keyed
  // by crew member then date, so a person in two rooms on one day is still
  // one day and the travel flags are ORed rather than whichever row came
  // back last.
  const { data: timecards } = await supabase
    .from('timecards')
    .select('crew_member_id, is_travel_day, travel_in_day, travel_out_day, rooms!inner ( work_days!inner ( date, show_id, activities ) )')
    .in('crew_member_id', crewMemberIds)
    .eq('rooms.work_days.show_id', showId)

  const byPerson = new Map<string, Map<string, EngagementDay>>()
  for (const t of (timecards ?? []) as any[]) {
    const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    if (!t.crew_member_id || !wd?.date) continue
    const byDate = byPerson.get(t.crew_member_id) ?? new Map<string, EngagementDay>()
    const prev = byDate.get(wd.date)
    byDate.set(wd.date, {
      date: wd.date,
      isTravelDay: !!prev?.isTravelDay || t.is_travel_day === true,
      travelIn: !!prev?.travelIn || t.travel_in_day === true,
      travelOut: !!prev?.travelOut || t.travel_out_day === true,
      activities: prev?.activities ?? wd.activities ?? [],
    })
    byPerson.set(t.crew_member_id, byDate)
  }

  let sent = 0
  const skipped: string[] = []
  for (const c of crew) {
    if (!c.email) { skipped.push(c.full_name); continue }
    const days = [...(byPerson.get(c.id)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    const result = await sendDaysChangedEmail({
      to: c.email,
      crewName: c.full_name,
      showName: show.name,
      orgName: org?.name ?? 'Your company',
      venue: show.venue ?? null,
      days,
    })
    if (result.error) { skipped.push(c.full_name); continue }
    sent++
  }

  return NextResponse.json({ ok: true, sent, skipped })
}
