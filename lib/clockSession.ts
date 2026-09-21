// Reading a crew clock link for the PUBLIC punch page.
//
// Plain module, no 'use client'.
//
// ============================ READ THIS FIRST =============================
// Everything here runs with the SERVICE ROLE, because the person opening the
// link has no login — the unguessable token is the authorization, exactly as
// lib/bookingInvite.ts and app/invite/[token]/page.tsx work.
//
// The service role BYPASSES THE day_rate COLUMN LOCKDOWN. Everywhere else in
// this app, `authenticated` holds no SELECT grant on day_rate and the database
// refuses to hand it over. Here that protection does not apply, so it is
// replaced by explicit column lists — and that is the ONLY thing standing
// between a crew member's link and every rate on the show.
//
// NEVER use select('*') in this file or in anything it feeds. What a page may
// show: the show name, venue, and — for a personal link — THIS person's own
// name, room, role and punches. What it must never show: any rate, anybody
// else's punches or hours, show_notes, job_number, or client_company.
//
// One deliberate exception: a VENUE link lists the names of everyone staffed
// today, because picking your own name off a list is the whole point of it.
// Names only — no roles, no contact details, no times.
// ==========================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { todayInZone } from '@/lib/showStatus'
import { isClockLinkExpired, pickShowDay } from '@/lib/clockLinks'
import type { Punch } from '@/lib/punches'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One room a person is working today, with the punches they already have. */
export type ClockAssignment = {
  timecardId: string
  room: string
  role: string | null
  isTravelDay: boolean
  /**
   * THE HYBRID LEGS, which are not the same thing as isTravelDay. A plain
   * travel day has no work and no punch grid; a leg means they travel AND
   * work, and the travel is flat pay on top of the hours — so the grid stays
   * live and the screen only SAYS the leg is there.
   */
  travelIn: boolean
  travelOut: boolean
  /** no_show | cancelled | null — the day was booked but not worked (0027). */
  absence: 'no_show' | 'cancelled' | null
  /**
   * `source` is REQUIRED on this path, unlike the shared Punch type where it is
   * optional. The crew screen gates editing and clearing on it, so a query that
   * forgets to select it would silently mark every punch as the PM's. Requiring
   * it here turns that into a compile error.
   */
  punches: (Punch & { source: 'staff' | 'crew' })[]
}

export type ClockView = {
  token: string
  /** A personal link identifies somebody; a venue link asks who you are. */
  kind: 'personal' | 'venue'
  showId: string
  showName: string
  venue: string | null
  organizationName: string
  timeZone: string
  /** Today's date IN THE SHOW'S ZONE. Never the server's — see below. */
  today: string
  /** The day being shown. Equals `today` unless one was asked for. */
  selectedDate: string
  /** Every work day of the show, ascending — the day arrows walk this. */
  days: string[]
  /** organizations.timecard_rounding_minutes: the grid crew times snap to. */
  roundingMinutes: number
  finalized: boolean
  expired: boolean
  revoked: boolean
  /** Personal links only. */
  me: { crewMemberId: string; name: string; assignments: ClockAssignment[] } | null
  /** Venue links only: today's rooms and who is in them, names only. */
  roster: { room: string; people: { crewMemberId: string; name: string }[] }[]
  /**
   * Who to ring on this show, if anybody was named. Per SHOW rather than per
   * person (Dan's call, 2026-09-20): the number a crew member needs is whoever
   * is on site that week, which is not always the app-level PM.
   *
   * Null when no phone was entered — a name with no number is not a contact,
   * and a block that cannot be tapped is worse than no block.
   */
  contact: { name: string; phone: string } | null
}

/**
 * Everything the /clock page needs, for either kind of link.
 *
 * "Today" is resolved HERE, on the server, from the show's own timezone. That
 * is what makes a bookmarked link safe: it can only ever read or write the
 * current day of that show, so a link saved on Monday cannot be used to
 * back-date Sunday. Deriving it from the visitor's device would hand that
 * control to the phone's clock; deriving it from UTC is the bug this app has
 * already shipped twice.
 */
/**
 * The show's on-site contact, or null.
 *
 * A NUMBER IS WHAT MAKES IT A CONTACT. With a name and no phone there is
 * nothing to tap, and a block that looks tappable and is not is worse than no
 * block at all — so the phone is what decides, and the name falls back to a
 * plain word when only the number was entered.
 */
function onsiteContact(show: { onsite_contact_name?: string | null; onsite_contact_phone?: string | null }) {
  const phone = (show.onsite_contact_phone ?? '').trim()
  if (!phone) return null
  return { name: (show.onsite_contact_name ?? '').trim() || 'Your PM', phone }
}

export async function loadClockView(
  token: string,
  requestedDate?: string,
): Promise<ClockView | null> {
  // Reject anything that is not a uuid before querying, so a malformed token
  // is a clean miss rather than a Postgres cast error.
  if (!UUID.test(token)) return null

  const admin = createAdminClient()

  const { data: link } = await admin
    .from('clock_links')
    .select('id, token, show_id, crew_member_id, organization_id, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle()

  if (!link) return null

  // EVERYTHING THE LINK ALONE CAN ASK FOR, AT ONCE. These four reads only need
  // ids the link row already carries, so waiting for one before starting the
  // next bought nothing — and this page is opened on a phone, on venue wifi,
  // by somebody standing at a loading dock (Dan, 2026-09-17: "Why would it take
  // the crew timecards so long to load on their individual links?"). The work
  // days come back with their ids so the chosen day needs no second lookup.
  const [{ data: show }, { data: org }, { data: allDays }, { data: crew }] = await Promise.all([
    // Explicit columns: shows carries show_notes, job_number and
    // client_company, none of which are the crew member's business.
    admin.from('shows')
      .select('id, name, venue, city_state, timezone_identifier, finalized_at, end_date, onsite_contact_name, onsite_contact_phone')
      .eq('id', link.show_id).maybeSingle(),
    admin.from('organizations')
      .select('name, timecard_rounding_minutes').eq('id', link.organization_id).maybeSingle(),
    admin.from('work_days').select('id, date').eq('show_id', link.show_id).order('date'),
    link.crew_member_id
      ? admin.from('crew_members').select('full_name').eq('id', link.crew_member_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (!show) return null

  const timeZone = show.timezone_identifier || 'America/Chicago'
  const today = todayInZone(timeZone)

  const days = (allDays ?? []).map(d => d.date as string)

  // A requested day is honoured only if it is genuinely a day OF THIS SHOW.
  // Anything else — a malformed string, a date the show does not run, another
  // show's date — silently falls back to today rather than erroring, because
  // the only way to send one is to edit the URL by hand.
  const selectedDate = pickShowDay(days, today, requestedDate)

  const base = {
    token: link.token,
    showId: show.id,
    showName: show.name,
    venue: show.venue ?? show.city_state ?? null,
    organizationName: org?.name ?? 'the production team',
    timeZone,
    today,
    selectedDate,
    days,
    roundingMinutes: org?.timecard_rounding_minutes ?? 1,
    finalized: !!show.finalized_at,
    // Derived from the show, never from link.expires_at — see isClockLinkExpired.
    expired: isClockLinkExpired(show.end_date, timeZone),
    revoked: !!link.revoked_at,
    contact: onsiteContact(show),
  }

  // Read in the batch above, but checked here: a personal link must still know
  // whose it is on a day they are not working — otherwise the masthead renders
  // a blank name and the day arrows look like somebody else's screen.
  if (link.crew_member_id && !crew) return null

  const emptyMe = link.crew_member_id
    ? { crewMemberId: link.crew_member_id, name: crew!.full_name, assignments: [] as ClockAssignment[] }
    : null

  // The selected day's work day, out of the list already fetched rather than a
  // second query for a row we have. A show that isn't running that day has
  // none, which is a legitimate state ("nothing on"), not an error.
  const workDay = (allDays ?? []).find(d => d.date === selectedDate) ?? null

  if (!workDay) {
    return { ...base, kind: link.crew_member_id ? 'personal' : 'venue', me: emptyMe, roster: [] }
  }

  const { data: rooms } = await admin
    .from('rooms').select('id, name').eq('work_day_id', workDay.id)
  const roomIds = (rooms || []).map(r => r.id)
  const roomName = new Map((rooms || []).map(r => [r.id, r.name]))
  if (roomIds.length === 0) {
    return { ...base, kind: link.crew_member_id ? 'personal' : 'venue', me: emptyMe, roster: [] }
  }

  // ---- Venue link: the roster to pick from ------------------------------
  if (!link.crew_member_id) {
    // Names only, and no day_rate. Declined bookings are excluded: that
    // person is not working, so offering their name would let them clock in
    // to a job they turned down.
    const { data: staffed } = await admin
      .from('timecards')
      .select('crew_member_id, crew_member_name, room_id')
      .in('room_id', roomIds)
      .not('crew_member_id', 'is', null)
      .neq('booking_status', 'declined')

    const grouped = new Map<string, { crewMemberId: string; name: string }[]>()
    for (const t of staffed || []) {
      const name = roomName.get(t.room_id) || 'Room'
      const list = grouped.get(name) || []
      list.push({ crewMemberId: t.crew_member_id as string, name: t.crew_member_name || 'Unnamed' })
      grouped.set(name, list)
    }
    const roster = [...grouped.entries()]
      .map(([room, people]) => ({
        room,
        people: people.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.room.localeCompare(b.room))

    return { ...base, kind: 'venue', me: null, roster }
  }

  // ---- Personal link: this person's own day -----------------------------
  const assignments = await assignmentsFor(admin, link.crew_member_id, roomIds, roomName)

  return {
    ...base,
    kind: 'personal',
    me: { crewMemberId: link.crew_member_id, name: crew!.full_name, assignments },
    roster: [],
  }
}

/**
 * This person's rooms and punches on ONE day of a show. Shared by the link
 * path and the login path (Section 3, 2026-09-06): same columns, same shape,
 * same rules. No day_rate in the column list — see the header. Declined rows
 * are excluded for the same reason the venue roster excludes them.
 */
async function assignmentsFor(
  admin: ReturnType<typeof createAdminClient>,
  crewMemberId: string,
  roomIds: string[],
  roomName: Map<string, string>,
): Promise<ClockAssignment[]> {
  // THE PUNCHES COME BACK WITH THE TIMECARDS, in one request. Reading the
  // cards and then asking for their punches was two round trips where the
  // second could not start until the first landed, on the slowest connection
  // any screen in this app runs on.
  //
  // `source` is NOT optional here, whatever the Punch type says: the crew
  // screen decides from it whether a punch is this person's to edit, and
  // omitting it made every punch read as PM-entered — locking crew out of
  // their own times. ClockAssignment.punches requires it so the compiler
  // catches a repeat.
  const { data: mine } = await admin
    .from('timecards')
    .select('id, role, is_travel_day, travel_in_day, travel_out_day, absence, room_id, punches ( id, timecard_id, punch_type, punched_at, source )')
    .eq('crew_member_id', crewMemberId)
    .in('room_id', roomIds)
    .neq('booking_status', 'declined')

  const punches = (mine || []).flatMap((t: any) => (t.punches ?? []))

  return (mine || []).map(t => ({
    timecardId: t.id,
    room: roomName.get(t.room_id) || 'Room',
    role: t.role ?? null,
    isTravelDay: t.is_travel_day === true,
    travelIn: t.travel_in_day === true,
    travelOut: t.travel_out_day === true,
    absence: t.absence === 'no_show' || t.absence === 'cancelled' ? t.absence : null,
    punches: (punches || [])
      .filter((p: any) => p.timecard_id === t.id)
      .map((p: any) => ({
        id: p.id, punch_type: p.punch_type, punched_at: p.punched_at,
        source: (p.source === 'crew' ? 'crew' : 'staff') as 'staff' | 'crew',
      }))
      .sort((a: Punch, b: Punch) => a.punched_at.localeCompare(b.punched_at)),
  })).sort((a, b) => a.room.localeCompare(b.room))
}

/**
 * The crew screen for a SIGNED-IN person on a show they are staffed on
 * (Section 3, 2026-09-06). Same view the link builds, minus the link: no
 * token, no expiry, no revocation — you are staffed or you are not.
 * `showId` must already have passed the caller's own RLS (the page read it);
 * the caller's directory entry is found through crew_members.profile_id.
 */
export async function loadClockViewForProfile(
  showId: string,
  profileId: string,
  requestedDate?: string,
): Promise<ClockView | null> {
  if (!UUID.test(showId) || !UUID.test(profileId)) return null
  const admin = createAdminClient()

  // The show and its days need only the id we were handed, so they go together;
  // the organization and this person's directory entry need the show's
  // organization_id and follow. Same reasoning as the link path above — see the
  // note there. Two waits instead of four.
  const [{ data: show }, { data: allDays }] = await Promise.all([
    admin.from('shows')
      .select('id, name, venue, city_state, organization_id, timezone_identifier, finalized_at, end_date, onsite_contact_name, onsite_contact_phone')
      .eq('id', showId).maybeSingle(),
    admin.from('work_days').select('id, date').eq('show_id', showId).order('date'),
  ])
  if (!show) return null

  const [{ data: org }, { data: crew }] = await Promise.all([
    admin.from('organizations').select('name, timecard_rounding_minutes').eq('id', show.organization_id).maybeSingle(),
    admin.from('crew_members').select('id, full_name')
      .eq('organization_id', show.organization_id).eq('profile_id', profileId).maybeSingle(),
  ])
  if (!crew) return null

  const timeZone = show.timezone_identifier || 'America/Chicago'
  const today = todayInZone(timeZone)
  const days = (allDays ?? []).map(d => d.date as string)
  const selectedDate = pickShowDay(days, today, requestedDate)

  const base = {
    token: '',
    kind: 'personal' as const,
    showId: show.id,
    showName: show.name,
    venue: show.venue ?? show.city_state ?? null,
    organizationName: org?.name ?? 'the production team',
    timeZone,
    today,
    selectedDate,
    days,
    roundingMinutes: org?.timecard_rounding_minutes ?? 1,
    finalized: !!show.finalized_at,
    expired: false,
    revoked: false,
    roster: [] as ClockView['roster'],
    contact: onsiteContact(show),
  }
  const me = { crewMemberId: crew.id, name: crew.full_name, assignments: [] as ClockAssignment[] }

  const workDay = (allDays ?? []).find(d => d.date === selectedDate) ?? null
  if (!workDay) return { ...base, me }
  const { data: rooms } = await admin.from('rooms').select('id, name').eq('work_day_id', workDay.id)
  const roomIds = (rooms || []).map(r => r.id)
  const roomName = new Map((rooms || []).map(r => [r.id, r.name]))
  if (roomIds.length === 0) return { ...base, me }

  me.assignments = await assignmentsFor(admin, crew.id, roomIds, roomName)
  return { ...base, me }
}
