import type { SupabaseClient } from '@supabase/supabase-js'
import { buildReadyEmail, compressDays, sendReadyEmail } from '@/lib/readyEmail'
import { describeShowDates } from '@/lib/pmInviteEmail'
import { dayLabel } from '@/lib/dayActivities'
import { siteOrigin } from '@/lib/siteOrigin'

// THE ONE PLACE the ready email is decided. Called after anything that can
// complete a show: a crew confirmation (/api/bookings/respond) and a PM
// accepting (/api/pm/accept). Idempotent by ready_email_sent_at; a show that
// later reopens a slot does not unsend or resend it.
export async function maybeSendReadyEmail(admin: SupabaseClient, showId: string): Promise<{ sent: boolean; reason: string }> {
  try {
    const { data: show } = await admin.from('shows')
      .select('id, name, venue, city_state, start_date, end_date, organization_id, pm_profile_id, pm_accepted_at, ready_email_sent_at, finalized_at, archived')
      .eq('id', showId).maybeSingle()
    if (!show) return { sent: false, reason: 'no show' }
    if (show.ready_email_sent_at) return { sent: false, reason: 'already sent' }
    if (!show.pm_profile_id || !show.pm_accepted_at) return { sent: false, reason: 'no accepted PM' }
    if (show.finalized_at || show.archived) return { sent: false, reason: 'closed' }

    const [{ data: slots }, { data: cards }] = await Promise.all([
      admin.from('crew_call_positions').select('id, rooms!inner(show_id), timecards(booking_status)').eq('rooms.show_id', showId),
      admin.from('timecards')
        .select('id, crew_member_name, role, booking_status, crew_member_id, rooms!inner(name, work_days!inner(date, activities))')
        .eq('show_id', showId).neq('booking_status', 'declined'),
    ])
    // No positions and no live timecards is not "fully staffed" — it's nothing to staff.
    if (((slots ?? []).length === 0) && ((cards ?? []).length === 0)) return { sent: false, reason: 'nothing to staff' }
    const open = ((slots ?? []) as any[]).filter(p => !((p.timecards ?? []) as any[]).some(t => t.booking_status !== 'declined')).length
    const waiting = ((cards ?? []) as any[]).filter(t => t.booking_status === 'pencilled' || t.booking_status === 'invited').length
    if (open > 0 || waiting > 0) return { sent: false, reason: `${open} open, ${waiting} waiting` }

    const [{ data: pm }, { data: org }] = await Promise.all([
      admin.from('profiles').select('email, full_name').eq('id', show.pm_profile_id).maybeSingle(),
      admin.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
    ])
    if (!pm?.email) return { sent: false, reason: 'PM has no email' }

    // ROSTER BY ROOM (Dan, 2026-09-09), each person carrying their own dates
    // in that room. A room is what a PM hands to somebody, so a room is the
    // block; a person in two rooms is two entries, with the dates they are in
    // each — overlapping dates included, because that is a double-booking the
    // PM needs to see rather than a duplicate to tidy away.
    //
    // Rooms are per work-day rows, so a room across the run is matched by NAME.
    // Keyed by (room, person, role): one person legitimately holds two roles.
    // NO PHONE NUMBERS (Dan, 2026-09-09). They were on every line; the roster
    // is who is in which room and when, and the numbers are in the directory.
    const byRoom = new Map<string, Map<string, { name: string; role: string | null; dates: Set<string> }>>()
    for (const t of (cards ?? []) as any[]) {
      const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
      const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
      if (!wd?.date || !room?.name) continue
      const people = byRoom.get(room.name) ?? new Map()
      const key = `${t.crew_member_name}|${t.role ?? ''}`
      const p = people.get(key) ?? {
        name: t.crew_member_name, role: t.role ?? null, dates: new Set<string>(),
      }
      p.dates.add(wd.date)
      people.set(key, p); byRoom.set(room.name, people)
    }
    const input = {
      to: pm.email, pmName: pm.full_name ?? null, showName: show.name,
      dates: describeShowDates(show.start_date, show.end_date), venue: show.venue || show.city_state || null,
      orgName: org?.name ?? 'Your company', link: `${siteOrigin()}/dashboard/shows/${show.id}`,
      rooms: [...byRoom.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, people]) => ({
          name,
          people: [...people.values()]
            .sort((x, y) => x.name.localeCompare(y.name))
            .map(p => ({ name: p.name, role: p.role, days: compressDays([...p.dates]) })),
        })),
    }

    // Claim the row BEFORE sending, then send. Two confirmations landing
    // together could otherwise both read ready_email_sent_at as null and
    // both send: this UPDATE...WHERE ready_email_sent_at IS NULL only
    // matches for whichever caller gets there first, so a lost race sees
    // claimed=[] and returns 'already sent' without ever calling Resend.
    // If the send then fails, the claim is released so a later trigger
    // (the next confirm, or a retry) can still send it.
    const { data: claimed, error: claimError } = await admin.from('shows')
      .update({ ready_email_sent_at: new Date().toISOString() })
      .eq('id', show.id).is('ready_email_sent_at', null).select('id')
    if (claimError) return { sent: false, reason: `claim failed: ${claimError.message}` }
    if (!claimed?.length) return { sent: false, reason: 'already sent' }

    const { error } = await sendReadyEmail(input)
    if (error) {
      // A stuck claim means every later call sees "already sent" — surface the release error.
      const { error: releaseError } = await admin.from('shows').update({ ready_email_sent_at: null }).eq('id', show.id)
      if (releaseError) {
        console.error(`ready email: send failed (${error}) AND the claim could not be released (${releaseError.message}); show ${show.id} is stamped sent without an email`)
        return { sent: false, reason: `send failed and claim stuck: ${error}` }
      }
      return { sent: false, reason: error }
    }
    return { sent: true, reason: 'sent' }
  } catch (e) {
    // This function's promise is "never fails the calling route" — a thrown
    // error must come back as a reason, not an exception the caller has to
    // remember to catch.
    return { sent: false, reason: e instanceof Error ? e.message : 'unexpected error' }
  }
}

const EXPECTED_READY_REASONS = new Set(['already sent', 'no accepted PM', 'closed', 'no show', 'nothing to staff'])

/**
 * True for a reason maybeSendReadyEmail returns in the ordinary course of
 * business (not yet ready, already handled, nothing to do) rather than a
 * real failure worth logging. Shared by both call sites' console.error
 * guards so the "expected" list lives in one place.
 */
export function isExpectedReadyReason(reason: string): boolean {
  return EXPECTED_READY_REASONS.has(reason) || /^\d+ open, \d+ waiting$/.test(reason)
}
