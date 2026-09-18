import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isClockLinkExpired } from '@/lib/clockLinks'
import { rateLimitOr, clientIp } from '@/lib/rateLimit'
import { normalizeActivities } from '@/lib/dayActivities'
import { travelOffer, travelFlags, NO_TRAVEL } from '@/lib/crewTravel'

// A crew member saying they travelled, on their own day.
//
// POST ONLY and service role, the same bargain as the punch route beside it:
// these links get pasted into Slack, and a GET that recorded anything would be
// recorded by the unfurler. The token is the authorization, so every rule the
// database does not enforce lives here.
//
// THE CLIENT NEVER SAYS WHICH KIND OF TRAVEL IT IS. It sends "yes" or "no" for
// a day; the SERVER works out whether that means a travel day, a trip out or a
// trip home, from what the show is doing that day and where the day sits in
// this person's own run (lib/crewTravel.ts). That is not only kinder to read —
// it means a hand-edited request cannot choose the flag that pays best.
//
// The date is never taken from the request either: it comes from the work day
// the TIMECARD belongs to, exactly as the punch route does it, so the only
// reachable days are days this person is genuinely staffed on.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  let body: { token?: string; timecardId?: string; travelling?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { token, timecardId, travelling } = body
  if (!token || !timecardId || !UUID.test(token) || !UUID.test(timecardId) || typeof travelling !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createAdminClient()
  // Looser than the punch limits: somebody says this once or twice a day, and
  // a whole crew shares one venue address.
  const stop = await rateLimitOr(admin, [
    { key: `travel:${token}`, limit: 20, windowSeconds: 600 },
    { key: `travel-ip:${clientIp(request)}`, limit: 200, windowSeconds: 600 },
  ])
  if (stop) return stop

  const { data: link } = await admin
    .from('clock_links')
    .select('id, show_id, crew_member_id, revoked_at')
    .eq('token', token)
    .maybeSingle()

  // A venue code identifies nobody, so it can never say who travelled.
  if (!link || !link.crew_member_id) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }
  if (link.revoked_at) {
    return NextResponse.json({ error: 'This link has been turned off. Ask your PM for a new one.' }, { status: 400 })
  }

  const { data: show } = await admin
    .from('shows')
    .select('id, timezone_identifier, finalized_at, end_date')
    .eq('id', link.show_id).maybeSingle()
  if (!show) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

  if (isClockLinkExpired(show.end_date, show.timezone_identifier || 'America/Chicago')) {
    return NextResponse.json({ error: 'This link has expired. Ask your PM for a new one.' }, { status: 400 })
  }
  // Pre-checked rather than left to the trigger: the service role does NOT
  // bypass triggers, so without this a crew member gets a raw 500.
  if (show.finalized_at) {
    return NextResponse.json({ error: 'This show has been closed out. Ask your PM.' }, { status: 400 })
  }

  // The card, its day, and what the show is doing that day.
  const { data: card } = await admin
    .from('timecards')
    .select('id, crew_member_id, is_travel_day, travel_in_day, travel_out_day, travel_source, absence, show_id, rooms!inner ( work_days!inner ( date, activities ) ), punches ( id )')
    .eq('id', timecardId)
    .maybeSingle()

  if (!card || card.crew_member_id !== link.crew_member_id || card.show_id !== show.id) {
    return NextResponse.json({ error: 'That day is not yours.' }, { status: 404 })
  }
  if (card.absence) {
    return NextResponse.json({ error: 'That day is marked as missed. Ask your PM.' }, { status: 400 })
  }

  // CREW MAY UNDO WHAT THEY SAID, NEVER WHAT THE PM SAID — the same rule the
  // punch screen runs on. A PM-set travel day is the PM's to change.
  const alreadySet = card.is_travel_day || card.travel_in_day || card.travel_out_day
  if (alreadySet && card.travel_source !== 'crew') {
    return NextResponse.json({ error: 'Your PM set this day. Ask them to change it.' }, { status: 400 })
  }

  const room: any = Array.isArray(card.rooms) ? card.rooms[0] : card.rooms
  const workDay: any = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
  const date = workDay?.date as string | undefined
  if (!date) return NextResponse.json({ error: 'That day is not yours.' }, { status: 404 })

  // Every day of theirs on this show, so first and last are known.
  const { data: mine } = await admin
    .from('timecards')
    .select('rooms!inner ( work_days!inner ( date ) )')
    .eq('crew_member_id', link.crew_member_id)
    .eq('show_id', show.id)
    .neq('booking_status', 'declined')

  const myDates = [...new Set((mine ?? []).map((row: any) => {
    const r = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms
    const w = Array.isArray(r?.work_days) ? r.work_days[0] : r?.work_days
    return w?.date as string
  }).filter(Boolean))].sort()

  const offer = travelOffer({
    activities: normalizeActivities(workDay?.activities),
    firstOfRun: myDates[0] === date,
    lastOfRun: myDates[myDates.length - 1] === date,
  })

  // Clearing needs no offer — whatever is set is theirs to take back.
  if (travelling && !offer) {
    return NextResponse.json({ error: 'Travel is not offered on that day.' }, { status: 400 })
  }

  // A TRAVEL DAY MAY CARRY TIME, and which of the three columns gets set
  // follows whether it does — see lib/crewTravel.ts for why that is a payroll
  // rule and not a presentation one. Nothing is refused: a day with times on it
  // becomes travel-and-work rather than being turned away.
  const flags = travelling
    ? travelFlags(offer!.direction, (card.punches ?? []).length > 0)
    : NO_TRAVEL

  const write = {
    ...flags,
    // Back to the default once nothing is set, so an untouched day never looks
    // like somebody's claim.
    travel_source: travelling ? 'crew' : 'staff',
  }

  // Verified write: an UPDATE that matches nothing comes back successful with
  // no rows, which would otherwise read as a save that never happened.
  const { data: saved, error } = await admin
    .from('timecards').update(write).eq('id', card.id).select('id')
  if (error || !saved?.length) {
    return NextResponse.json({ error: error?.message ?? 'That did not save.' }, { status: 400 })
  }

  return NextResponse.json({ ok: true, ...flags })
}
