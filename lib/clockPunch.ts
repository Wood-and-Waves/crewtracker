import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PUNCH_ORDER, PUNCH_LABELS, getChronologyError, isEligibleForBatch, isWrapped,
  roundWallTime, clearBlockedReason, type Punch, type PunchType,
} from '@/lib/punches'
import type { Absence } from '@/lib/payroll'
import { zonedWallTimeToUtc, addDays } from '@/lib/datetime'

// Every rule of a crew member's own punch, in ONE place, used by both
//   app/api/clock/punch     — the no-login link (token = authorization)
//   app/api/clock/punch-me  — a signed-in crew-side login (Section 3, 2026-09-06)
// so the two cannot drift. The routes decide WHO is punching; this decides
// WHETHER and WHAT gets written. Service role throughout — see
// lib/clockSession.ts for why explicit column lists are the only protection.

export type CrewPunchRequest = {
  timecardId: string
  type: PunchType
  /** HH:MM wall clock in the show's zone; omitted = now. Validated by the route. */
  at?: string
  clear?: boolean
  /** Who is punching — resolved by the route from the token or the session. */
  crewMemberId: string
  showId: string
  /** clock_links.id for the token route, null for a login. */
  sourceLink: string | null
  /** auth.uid() for a login, null for a link. */
  createdBy: string | null
}

export type CrewPunchResult = { status: number; body: Record<string, unknown> }

const refuse = (status: number, error: string): CrewPunchResult => ({ status, body: { error } })

/**
 * Pure: may this punch be made? Null = yes; otherwise the sentence the crew
 * member reads. Order of checks matters and mirrors the tracker.
 */
export function punchRefusal(
  all: Punch[],
  isTravelDay: boolean,
  absence: Absence | null,
  type: PunchType,
  mine: (Punch & { source?: string }) | undefined,
): string | null {
  if (absence === 'cancelled') return 'That day was cancelled, so there are no punches to record. Talk to your PM if that is wrong.'
  if (absence === 'no_show') return 'That day is marked as a no-show. Talk to your PM if that is wrong.'
  if (isTravelDay) return 'That day is marked as a travel day, so there are no punches to record.'
  // A punch the PM entered is theirs. Crew may fix their OWN mistake but must
  // never overwrite a correction — which is exactly what the source column is for.
  if (mine && mine.source !== 'crew') {
    return `Your ${PUNCH_LABELS[type]} was set by your PM, so it can't be changed here. Ask them.`
  }
  // ORDER, which chronology does NOT cover. getChronologyError only checks
  // that the times of punches that EXIST run forwards; it is happy to accept
  // an M1 In when there is no M1 Out. "The previous punch must exist" is a
  // separate rule and isEligibleForBatch is where this app keeps it (the
  // two-check rule, CLAUDE.md). Skipped when correcting an existing punch:
  // chronology is the right judge then.
  if (!mine && !isEligibleForBatch(all, isTravelDay, type, absence)) {
    const requirement: PunchType | null =
      type === 'start' ? null
      : type === 'end' ? 'start'
      : PUNCH_ORDER[PUNCH_ORDER.indexOf(type) - 1]
    const why = isWrapped(all) && type !== 'end'
      ? 'You’ve already wrapped for today.'
      : requirement
        ? `Your ${PUNCH_LABELS[requirement]} isn’t recorded yet.`
        : 'That isn’t available right now.'
    return `${why} Ask your PM if that’s not right.`
  }
  return null
}

export async function applyCrewPunch(admin: SupabaseClient, req: CrewPunchRequest): Promise<CrewPunchResult> {
  const { timecardId, type, at, clear, crewMemberId, showId } = req

  const { data: show } = await admin
    .from('shows').select('id, organization_id, timezone_identifier, finalized_at')
    .eq('id', showId).maybeSingle()
  if (!show) return refuse(404, 'This show is not available.')
  const timeZone = show.timezone_identifier || 'America/Chicago'

  // Checked BEFORE writing. punches_blocked_when_finalized is a TRIGGER, and
  // the service role does not bypass triggers — so a punch on a closed-out show
  // would otherwise surface to a crew member as a raw 500.
  if (show.finalized_at) {
    return refuse(400, 'This show has been closed out, so times can no longer be changed. Talk to your PM.')
  }

  // The timecard must be THIS person's and on THIS show. Its own work day
  // supplies the date, so the caller never gets to name one.
  const { data: timecard } = await admin
    .from('timecards')
    .select('id, crew_member_id, is_travel_day, absence, rooms!inner ( work_days!inner ( date, show_id ) )')
    .eq('id', timecardId)
    .maybeSingle()
  const room = Array.isArray((timecard as any)?.rooms) ? (timecard as any).rooms[0] : (timecard as any)?.rooms
  const workDay = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
  if (!timecard || timecard.crew_member_id !== crewMemberId || workDay?.show_id !== show.id || !workDay?.date) {
    return refuse(400, "That isn't one of your shifts on this show.")
  }
  const punchDate = workDay.date as string

  const { data: existing } = await admin
    .from('punches').select('id, punch_type, punched_at, source').eq('timecard_id', timecardId)
  const all: Punch[] = (existing || [])
    .map(p => ({ id: p.id, punch_type: p.punch_type as PunchType, punched_at: p.punched_at }))
  const mine = (existing || []).find(p => p.punch_type === type)

  // ---- Clearing a punch the crew member entered themselves ----------------
  if (clear) {
    if (mine && mine.source !== 'crew') {
      return refuse(400, `Your ${PUNCH_LABELS[type]} was set by your PM, so it can't be cleared here. Ask them.`)
    }
    if (!mine) return refuse(400, 'There is nothing recorded to clear.')
    // Removing from the middle of a day would orphan whatever comes after it.
    const blocked = clearBlockedReason(all, type)
    if (blocked) return refuse(400, blocked)
    // Verified delete: a delete matching no row returns success with zero rows.
    const { data: gone, error } = await admin.from('punches').delete().eq('id', mine.id).select('id')
    if (error || !gone || gone.length === 0) {
      return refuse(500, error?.message ?? 'That did not clear. Try again, or tell your PM.')
    }
    return { status: 200, body: { ok: true, cleared: type } }
  }

  const refusal = punchRefusal(all, timecard.is_travel_day, (timecard.absence as Absence | null) ?? null, type, mine)
  if (refusal) return refuse(400, refusal)

  // The instant being recorded. `at` is a wall-clock time in the SHOW's zone
  // on the work day the server already resolved. No `at` means now. Snapped to
  // the company's grid server-side: `step` on a time input is a hint browsers
  // let you type past, and this is the value that gets paid.
  const { data: org } = await admin
    .from('organizations').select('timecard_rounding_minutes').eq('id', show.organization_id).maybeSingle()
  const roundingMinutes = org?.timecard_rounding_minutes ?? 1
  const wall = at ?? new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  const { timeStr, dayOffset } = roundWallTime(wall, roundingMinutes)
  const now = zonedWallTimeToUtc(addDays(punchDate, dayOffset), timeStr, timeZone)

  // Chronology, re-run server-side against every OTHER punch. Excluding this
  // type matches TimeEntryModal: replacing a punch must not be blocked by the
  // value it is replacing.
  const others: Punch[] = all.filter(p => p.punch_type !== type)
  const chronologyError = getChronologyError(now, type, others)
  if (chronologyError) return refuse(400, chronologyError)

  // Update-or-insert, never a blind insert: nothing in the database prevents a
  // second punch of the same type, so a blind insert would silently duplicate.
  const stamp = {
    punched_at: now.toISOString(),
    source: 'crew' as const,
    source_link: req.sourceLink,
    created_by: req.createdBy,
  }
  const written = mine
    ? await admin.from('punches').update(stamp).eq('id', mine.id).select('id')
    : await admin.from('punches').insert({ timecard_id: timecardId, punch_type: type, ...stamp }).select('id')
  if (written.error || !written.data || written.data.length === 0) {
    return refuse(500, written.error?.message ?? 'That did not save. Try again, or tell your PM.')
  }
  return { status: 200, body: { ok: true, punchType: type, punchedAt: now.toISOString() } }
}
