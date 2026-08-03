// Reading a booking invite for the PUBLIC response page.
//
// Plain module, no 'use client'.
//
// ============================ READ THIS FIRST =============================
// Everything here runs with the SERVICE ROLE, because the person opening the
// link has no login — the unguessable token is the authorization, exactly as
// app/invite/[token]/page.tsx works.
//
// The service role BYPASSES THE day_rate COLUMN LOCKDOWN. Everywhere else in
// this app, `authenticated` simply holds no SELECT grant on day_rate and the
// database refuses to hand it over. Here that protection does not apply, so it
// is replaced by explicit column lists — and that is the ONLY thing standing
// between a crew member's link and every rate on the show.
//
// NEVER use select('*') in this file or in anything it feeds. What the page may
// show: the organization, the show name, venue, dates, and THIS person's own
// name, role and dates. What it must never show: any rate, any other crew
// member, show_notes, job_number, or client_company.
// ==========================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import type { EngagementDay } from '@/lib/bookingEmail'

export type BookingInviteView = {
  token: string
  crewName: string
  showName: string
  venue: string | null
  cityState: string | null
  organizationName: string
  /** Just this person's days, ascending, each marked travel or work. */
  days: EngagementDay[]
  role: string | null
  expiresAt: string
  respondedAt: string | null
  response: 'confirmed' | 'declined' | null
  /** The show has been closed out; responding is no longer possible. */
  finalized: boolean
}

export async function loadBookingInvite(token: string): Promise<BookingInviteView | null> {
  // Reject anything that is not a uuid before querying. A malformed token
  // otherwise reaches Postgres as a cast error rather than a clean miss.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return null

  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('booking_invites')
    .select('id, token, show_id, crew_member_id, organization_id, expires_at, responded_at, response')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return null

  const [{ data: show }, { data: crew }, { data: org }] = await Promise.all([
    // Explicit columns. `shows` carries show_notes, job_number and
    // client_company, none of which are the crew member's business.
    admin.from('shows').select('id, name, venue, city_state, finalized_at').eq('id', invite.show_id).maybeSingle(),
    admin.from('crew_members').select('full_name').eq('id', invite.crew_member_id).maybeSingle(),
    admin.from('organizations').select('name').eq('id', invite.organization_id).maybeSingle(),
  ])

  if (!show || !crew) return null

  // This person's own days on this show. `role` is included and `day_rate` is
  // deliberately absent — see the header.
  //
  // DELIBERATELY INCLUDES DECLINED ROWS. This is the page a person declines ON;
  // filtering them out would blank their own booking the instant they answered,
  // which reads as the link breaking. Do not route this through liveBookings.
  const { data: timecards } = await admin
    .from('timecards')
    .select('role, is_travel_day, travel_in_day, travel_out_day, rooms!inner ( work_days!inner ( date, show_id ) )')
    .eq('crew_member_id', invite.crew_member_id)
    .eq('rooms.work_days.show_id', invite.show_id)

  // Keyed by date, flags ORed: somebody in two rooms on one day is one day, and
  // a travel flag on either row makes the day a travel day.
  const byDate = new Map<string, EngagementDay>()
  let role: string | null = null
  for (const t of (timecards ?? []) as any[]) {
    const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    if (wd?.date) {
      const prev = byDate.get(wd.date)
      byDate.set(wd.date, {
        date: wd.date,
        isTravelDay: !!prev?.isTravelDay || t.is_travel_day === true,
        travelIn: !!prev?.travelIn || t.travel_in_day === true,
        travelOut: !!prev?.travelOut || t.travel_out_day === true,
      })
    }
    if (!role && t.role) role = t.role
  }

  return {
    token: invite.token,
    crewName: crew.full_name,
    showName: show.name,
    venue: show.venue ?? null,
    cityState: show.city_state ?? null,
    organizationName: org?.name ?? 'the production team',
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    role,
    expiresAt: invite.expires_at,
    respondedAt: invite.responded_at ?? null,
    response: (invite.response as 'confirmed' | 'declined' | null) ?? null,
    finalized: !!show.finalized_at,
  }
}
