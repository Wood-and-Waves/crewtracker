import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'
import { worthTelling } from '@/lib/crewNotices'
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

  // Parsed before anything is asked of the network: a malformed body should
  // cost nothing, and showId is needed by the reads below anyway.
  let showId: string | undefined
  let crewMemberId: string | undefined
  let notify: boolean | undefined
  // WHICH DAYS. Omitted means the whole show, which is what every caller meant
  // before this existed and what "they are off the job" still means.
  let dates: string[] | undefined
  try {
    ({ showId, crewMemberId, notify, dates } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!showId || !crewMemberId) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // ONE ROUND TRIP'S WALL TIME INSTEAD OF THREE. Who you are and what you are
  // removing do not depend on each other, and this route was four sequential
  // trips to Supabase before it touched anything — most of the second it took
  // (Dan, 2026-09-15: "Removing someone is not [faster]").
  //
  // Issuing the reads beside the permission check hands nobody anything: both
  // run through the CALLER'S OWN SESSION, so RLS has already decided what they
  // may see, and canUseScheduling is a commercial gate rather than the data
  // boundary. NOTHING IS WRITTEN until both checks below have passed.
  const [me, { data: show }, { data: cards }, { data: punches }] = await Promise.all([
    getCurrentUser(),
    supabase.from('shows')
      .select('id, name, venue, organization_id, finalized_at').eq('id', showId).maybeSingle(),
    // Everything they hold on this show — declined rows included, so nothing of
    // theirs is left behind on a show they are off.
    supabase.from('timecards')
      .select('id, role, crew_member_name, booking_status, rooms!inner ( work_days!inner ( date ) )')
      .eq('show_id', showId).eq('crew_member_id', crewMemberId),
    // THE PUNCH GUARD, ASKED WITHOUT WAITING FOR THE TIMECARDS. It used to run
    // afterwards, keyed on the ids that read returned, which made it a fifth
    // trip in its own right. punches carries show_id since migration 0023, so
    // the same question — "has this person clocked anything on this show?" —
    // can be asked of punches directly and ride along with everything else.
    // The guard is unchanged; only its place in the queue is.
    // timecard_id, not just "is there one": the guard refuses per DAY now, so
    // it has to know which of their timecards carry worked time. Scoped to one
    // person on one show, so this is a handful of rows at most.
    supabase.from('punches')
      .select('timecard_id, timecards!inner ( crew_member_id )')
      .eq('show_id', showId).eq('timecards.crew_member_id', crewMemberId),
  ])

  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!canUseScheduling(me)) {
    return NextResponse.json({ error: 'Scheduling is not enabled for this account.' }, { status: 403 })
  }
  if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 })
  if (show.finalized_at) {
    return NextResponse.json({ error: 'This show has been closed out. Unlock it first.' }, { status: 400 })
  }
  if (!cards?.length) return NextResponse.json({ error: 'They are not on this show.' }, { status: 404 })

  const dateOf = (c: any) => {
    const room = Array.isArray(c.rooms) ? c.rooms[0] : c.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    return wd?.date as string | undefined
  }

  // SOME DAYS OR ALL OF THEM. Dan, 2026-09-15: "I just tried to remove a person
  // from one day. Under the idea that they weren't available. I could not
  // remove from just one day, it pulled from all." A scheduler losing somebody
  // for a Thursday is ordinary; making them drop the whole run and rebook four
  // days is not.
  const wanted = dates?.length ? new Set(dates) : null
  const targets = wanted ? cards.filter((c: any) => wanted.has(dateOf(c) ?? '')) : cards
  if (!targets.length) {
    return NextResponse.json({ error: 'They are not on this show on those days.' }, { status: 404 })
  }
  const ids = targets.map((c: any) => c.id as string)
  const removedDates = targets.map(dateOf).filter(Boolean) as string[]
  const keptDates = cards.filter((c: any) => !ids.includes(c.id)).map(dateOf).filter(Boolean) as string[]

  // The punch guard is per DAY now, for the same reason the removal is: a punch
  // on Monday is not a reason to refuse giving Thursday back. The days it
  // refuses are named, so the message says what to go and clear.
  const punchedDates = new Set(
    ((punches ?? []) as any[]).map(p => p.timecard_id as string),
  )
  const blocked = targets.filter((c: any) => punchedDates.has(c.id)).map(dateOf).filter(Boolean) as string[]
  if (blocked.length) {
    return NextResponse.json(
      { error: `They have punches recorded on ${compressDays(blocked)}, so removing that would delete worked time. Clear those on the tracker first.` },
      { status: 409 },
    )
  }

  const name = (targets[0] as any).crew_member_name as string
  const role = (targets[0] as any).role as string | null

  // A verified delete: zero rows means the policy refused, not that it worked.
  const { data: gone, error } = await supabase.from('timecards').delete().in('id', ids).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!gone?.length) {
    return NextResponse.json({ error: 'You do not have permission to change staffing on this show.' }, { status: 403 })
  }

  await logStaffingEvent(supabase, {
    showId, kind: 'released', crewMemberId, crewMemberName: name,
    role: role ?? undefined, days: removedDates.length ? compressDays(removedDates) : undefined,
    // Never asked, so there is nothing to pass on and the Scheduling screen
    // should not offer to. See worthTelling().
    nothingToTell: !worthTelling(targets.map((c: any) => c.booking_status)),
  })

  // STILL ON THE SHOW, just fewer days: the right message is their REVISED
  // schedule, not "you are no longer on Northwind" — and the route that builds
  // that already exists and lists a person's live days, which after this delete
  // are exactly the days they have left. The caller sends it rather than this
  // route growing a second copy of that email.
  const remaining = keptDates.length
  if (!notify || remaining > 0) {
    return NextResponse.json({ ok: true, removed: gone.length, remaining, emailed: false })
  }

  const [{ data: crew }, { data: org }] = await Promise.all([
    supabase.from('crew_members').select('full_name, email').eq('id', crewMemberId).maybeSingle(),
    supabase.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
  ])
  if (!crew?.email) {
    return NextResponse.json({ ok: true, removed: gone.length, remaining, emailed: false, warning: 'They have no email address on file, so nothing was sent.' })
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
    // The dates they were holding, read BEFORE the delete. This is the only
    // path that can name them: everywhere else the rows are gone by the time
    // the notice is offered.
    heldDates: removedDates.length ? compressDays(removedDates) : null,
  })
  if (mailError) {
    return NextResponse.json({ ok: true, removed: gone.length, remaining, emailed: false, warning: `They were removed, but the email did not send: ${mailError}` })
  }
  return NextResponse.json({ ok: true, removed: gone.length, remaining, emailed: true })
}
