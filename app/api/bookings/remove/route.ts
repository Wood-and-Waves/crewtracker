import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'
import { sendDaysChangedEmail } from '@/lib/daysChangedEmail'

// Taking somebody off a show, from the status chip (Dan, 2026-09-08, reversing
// an earlier call that removal should stay under the room's ⋮ → Edit crew:
// "I would like add the option to remove in the pencilled dropdown").
//
// SHOW-WIDE, like every other thing that chip does. Recording an answer is
// show-wide, so removal is too: the alternative — a chip that answers for the
// whole run but removes one day — is the kind of split that leaves somebody on
// a Tuesday nobody meant to book.
//
// IT REFUSES ON PUNCHES. A timecard carrying punches is worked time, and
// deleting it would take real hours out of payroll to tidy up a schedule. The
// tracker's absence flags exist for a day that went wrong; this is for a
// booking that should not be there at all.
//
// AUTHORIZATION IS RLS: every read and write goes through the caller's session,
// so the timecards policies (can_edit_timecards) decide. Telling the person is
// OFFERED by the caller — the same rule as every other change notice — and
// arrives as `notify`, never as a default.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!canUseScheduling(await getCurrentUser())) {
    return NextResponse.json({ error: 'Scheduling is not enabled for this account.' }, { status: 403 })
  }

  let showId: string | undefined
  let crewMemberId: string | undefined
  let notify: boolean | undefined
  try {
    ({ showId, crewMemberId, notify } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!showId || !crewMemberId) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { data: show } = await supabase
    .from('shows').select('id, name, venue, organization_id, finalized_at').eq('id', showId).maybeSingle()
  if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 })
  if (show.finalized_at) {
    return NextResponse.json({ error: 'This show has been closed out. Unlock it first.' }, { status: 400 })
  }

  // Everything they hold on this show — declined rows included, so nothing of
  // theirs is left behind on a show they are off.
  const { data: cards } = await supabase
    .from('timecards')
    .select('id, role, crew_member_name, rooms!inner ( work_days!inner ( date ) )')
    .eq('show_id', showId).eq('crew_member_id', crewMemberId)
  if (!cards?.length) return NextResponse.json({ error: 'They are not on this show.' }, { status: 404 })

  const ids = cards.map((c: any) => c.id as string)
  const { data: punches } = await supabase.from('punches').select('id').in('timecard_id', ids).limit(1)
  if (punches?.length) {
    return NextResponse.json(
      { error: 'They have punches recorded on this show, so removing them would delete worked time. Clear those on the tracker first.' },
      { status: 409 },
    )
  }

  const dates = cards.map((c: any) => {
    const room = Array.isArray(c.rooms) ? c.rooms[0] : c.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    return wd?.date as string | undefined
  }).filter(Boolean) as string[]
  const name = (cards[0] as any).crew_member_name as string
  const role = (cards[0] as any).role as string | null

  // A verified delete: zero rows means the policy refused, not that it worked.
  const { data: gone, error } = await supabase.from('timecards').delete().in('id', ids).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!gone?.length) {
    return NextResponse.json({ error: 'You do not have permission to change staffing on this show.' }, { status: 403 })
  }

  await logStaffingEvent(supabase, {
    showId, kind: 'released', crewMemberId, crewMemberName: name,
    role: role ?? undefined, days: dates.length ? compressDays(dates) : undefined,
  })

  if (!notify) return NextResponse.json({ ok: true, removed: gone.length, emailed: false })

  const [{ data: crew }, { data: org }] = await Promise.all([
    supabase.from('crew_members').select('full_name, email').eq('id', crewMemberId).maybeSingle(),
    supabase.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
  ])
  if (!crew?.email) {
    return NextResponse.json({ ok: true, removed: gone.length, emailed: false, warning: 'They have no email address on file, so nothing was sent.' })
  }
  // The removal wording of the crew change notice: there are no days left to
  // list, so it says what happened instead of printing an empty schedule.
  const { error: mailError } = await sendDaysChangedEmail({
    to: crew.email,
    crewName: crew.full_name ?? name,
    showName: show.name,
    orgName: org?.name ?? 'Your company',
    venue: show.venue ?? null,
    days: [],
    removed: true,
  })
  if (mailError) {
    return NextResponse.json({ ok: true, removed: gone.length, emailed: false, warning: `They were removed, but the email did not send: ${mailError}` })
  }
  return NextResponse.json({ ok: true, removed: gone.length, emailed: true })
}
