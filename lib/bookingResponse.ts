// Recording a crew member's answer to a booking request.
//
// Lives here rather than in the route because since 2026-09-08 there are TWO
// ways in: the page's buttons, and the CONFIRM button in the email itself, which
// answers as the page loads (Dan: "This should have a Accept or Decline button.
// Not a link to accept or decline"). One implementation, two callers.
//
// A DECLINE still takes a tap on the page, because a decline carries an
// optional note to whoever is staffing the show and the reason is the useful
// part. The email's Decline button opens the page with that box ready.
//
// A decline applies to the WHOLE show. Dan: "A decline is for the entire show.
// They would need to work everything." Every timecard of theirs on that show
// moves to 'declined', which frees each position: the partial unique index on
// timecards excludes declined rows, so the scheduler can put somebody else in
// without deleting the record that this person said no.
//
// SERVICE ROLE: no login, the token is the authorization.

import { createAdminClient } from '@/lib/supabase/admin'
import { sendDeclineNoticeEmail } from '@/lib/bookingEmail'
import { siteOrigin } from '@/lib/siteOrigin'
import { maybeSendReadyEmail, isExpectedReadyReason } from '@/lib/showReadiness'
import { logStaffingEvent } from '@/lib/staffingEvents'

export type BookingAnswer = 'confirmed' | 'declined'

export type RespondResult =
  | { ok: true; response: BookingAnswer }
  | { ok: false; status: number; error: string }

export async function respondToBooking(
  token: string,
  response: BookingAnswer,
  note?: string | null,
): Promise<RespondResult> {
  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('booking_invites')
    .select('id, show_id, crew_member_id, organization_id, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return { ok: false, status: 404, error: 'This link is not valid.' }

  if (new Date(invite.expires_at) < new Date()) {
    return { ok: false, status: 400, error: 'This request has expired. Please contact whoever booked you.' }
  }

  // Checked BEFORE writing. block_writes_when_finalized is a trigger, and the
  // service role does not bypass triggers — so a response to a closed-out show
  // would otherwise surface to a crew member as a raw 500.
  const { data: show } = await admin
    .from('shows')
    .select('id, name, finalized_at, sent_to_scheduling_at, organization_id, created_by')
    .eq('id', invite.show_id)
    .maybeSingle()

  if (!show) return { ok: false, status: 404, error: 'This link is not valid.' }
  if (show.finalized_at) {
    return { ok: false, status: 400, error: 'This show has been closed out, so it can no longer be changed. Please contact whoever booked you.' }
  }

  const now = new Date().toISOString()

  const { error: inviteError } = await admin
    .from('booking_invites')
    .update({ responded_at: now, response, note: note?.slice(0, 500) || null })
    .eq('id', invite.id)

  if (inviteError) {
    return { ok: false, status: 500, error: inviteError.message }
  }

  // Their timecards on this show. Fetched then updated by id: a nested filter
  // cannot be used as the target of an update.
  const { data: theirs } = await admin
    .from('timecards')
    .select('id, role, rooms!inner ( work_days!inner ( show_id ) )')
    .eq('crew_member_id', invite.crew_member_id)
    .eq('rooms.work_days.show_id', invite.show_id)

  // Hoisted above the confirm/decline split — both branches log a staffing
  // event with this person's name, and the decline notice email below needs
  // it too.
  const { data: crew } = await admin.from('crew_members').select('full_name').eq('id', invite.crew_member_id).maybeSingle()

  const ids = (theirs ?? []).map((t: any) => t.id)
  if (ids.length > 0) {
    const { error: tcError } = await admin
      .from('timecards')
      .update({ booking_status: response, booking_responded_at: now })
      .in('id', ids)

    if (tcError) {
      return { ok: false, status: 500, error: tcError.message }
    }
  }

  await logStaffingEvent(admin, {
    showId: invite.show_id,
    kind: response === 'confirmed' ? 'accepted' : 'declined',
    crewMemberId: invite.crew_member_id,
    crewMemberName: crew?.full_name ?? 'A crew member',
    role: (theirs?.[0] as any)?.role ?? null,
  })

  // A confirm can be the LAST position on the show — check whether it just
  // went fully staffed. Never fails the response either way: the answer is
  // recorded regardless of whether the ready email could be sent.
  if (response === 'confirmed') {
    const { sent, reason } = await maybeSendReadyEmail(admin, invite.show_id)
    if (!sent && !isExpectedReadyReason(reason)) {
      console.error('maybeSendReadyEmail failed after a confirm:', reason)
    }
  }

  // A confirm needs no announcement — the schedule shows it. A DECLINE is
  // actionable: somebody has to find a replacement, and the sooner they know
  // the better. Failure to notify never fails the response; the answer is
  // recorded either way and telling the crew member otherwise would be a lie.
  //
  // Who "somebody" is depends on whether the show has been sent to scheduling
  // (piece C, 2026-09-07): sent, nobody owns it, so every scheduler in the
  // company hears about it; not sent, it's still the creator's to staff.
  if (response === 'declined') {
    let people: { email: string | null; name: string | null }[]
    if (show.sent_to_scheduling_at) {
      const { data: schedulers } = await admin.from('memberships')
        .select('profiles(email, full_name)')
        .eq('organization_id', show.organization_id).eq('can_manage_scheduling', true).is('deactivated_at', null)
      people = ((schedulers ?? []) as any[]).map(m => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return { email: (p?.email ?? null) as string | null, name: (p?.full_name ?? null) as string | null }
      })
    } else if (show.created_by) {
      const { data: creator } = await admin.from('profiles').select('email, full_name').eq('id', show.created_by).maybeSingle()
      people = creator ? [{ email: creator.email ?? null, name: creator.full_name ?? null }] : []
    } else {
      people = []
    }
    people = people.filter(p => p.email)

    if (people.length) {
      const origin = siteOrigin()  // never the Host header — see lib/siteOrigin.ts
      await Promise.all(people.map(p => sendDeclineNoticeEmail({
        to: p.email!,
        recipientName: p.name,
        crewName: crew?.full_name ?? 'A crew member',
        showName: show.name,
        note: note?.slice(0, 500) || null,
        link: `${origin}/dashboard/shows/${show.id}`,
      })))
    }
  }

  return { ok: true, response }
}
