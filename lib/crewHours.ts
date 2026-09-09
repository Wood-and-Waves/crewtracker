// A crew member's own hours across a whole show.
//
// Dan, 2026-09-08: "For the crew links. Would it be possible to have an
// overview type screen they can click on and see the week's hours?" Both
// crew-facing screens show ONE day at a time behind arrows, so the question
// crew actually ask — did all my punches land, and how many hours am I on for
// — could not be answered without walking the run a day at a time.
//
// THE WHOLE SHOW, not a calendar week (Dan, 2026-09-09). For a normal run they
// are the same thing, and slicing seven days out of a ten-day show would be
// arbitrary.
//
// HOURS, NEVER MONEY. The same rule the crew timesheet and the booking email
// follow. Nothing here reads day_rate, and nothing here reads punches.source
// either: a crew-entered hour is worth exactly what a PM-entered one is, and
// the moment a screen can tell them apart somebody will want them treated
// differently.
//
// Plain module, no 'use client' — the pure half is unit-tested and the loaders
// are server-side.

import { calculateNetHours, type PayrollRuleset, type TimecardLike } from '@/lib/payroll'

/** The instant of one punch, or null. Same read lib/timesheet.ts makes. */
function punchAt(tc: TimecardLike, type: 'start' | 'end'): string | null {
  return tc.punches.find(p => p.punch_type === type)?.punched_at ?? null
}

/** One of their days, as the list renders it. */
export type CrewHoursDay = {
  date: string
  room: string
  role: string | null
  /** Wall-clock strings, already formatted, or null when the punch is missing. */
  start: string | null
  end: string | null
  /**
   * What this day IS, when it is not an ordinary worked day. A travel day has
   * no punches by design, and an absent day was booked and not worked — both
   * need a word rather than a blank.
   */
  label: 'Travel' | 'No-show' | 'Cancelled' | null
  /** Net hours, the org's rounding applied — null when there is nothing to add up. */
  hours: number | null
  /** Started but never wrapped: the thing this screen exists to surface. */
  missing: boolean
}

export type CrewHours = {
  days: CrewHoursDay[]
  /** Days with hours on them. A travel or absent day is not a worked day. */
  workedDays: number
  totalHours: number
  /** At least one day started and never wrapped. */
  anyMissing: boolean
}

/** What one timecard needs to carry for this to work. */
export type CrewHoursInput = {
  date: string
  room: string
  role: string | null
  timecard: TimecardLike
}

/**
 * Their run, day by day, plus the total.
 *
 * A day is one of four things and the order matters: absent beats travel beats
 * missing beats worked. An absent day that also carries a stray punch is still
 * absent — that is the same precedence lib/payroll.ts applies, and the two must
 * not disagree about what a day was.
 */
export function summarizeCrewHours(
  input: CrewHoursInput[],
  ruleset: PayrollRuleset,
  roundingMinutes: number,
  fmtTime: (iso: string) => string,
): CrewHours {
  const days = [...input]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row): CrewHoursDay => {
      const tc = row.timecard
      const startAt = punchAt(tc, 'start')
      const endAt = punchAt(tc, 'end')
      const base = {
        date: row.date, room: row.room, role: row.role,
        start: startAt ? fmtTime(startAt) : null,
        end: endAt ? fmtTime(endAt) : null,
      }
      if (tc.absence) {
        return { ...base, start: null, end: null, label: tc.absence === 'no_show' ? 'No-show' : 'Cancelled', hours: null, missing: false }
      }
      // A PLAIN travel day only. travel_in_day / travel_out_day are hybrid days
      // additive to hours actually worked, so those punch and count normally.
      if (tc.is_travel_day) {
        return { ...base, start: null, end: null, label: 'Travel', hours: null, missing: false }
      }
      if (!startAt || !endAt) {
        return { ...base, label: null, hours: null, missing: true }
      }
      return { ...base, label: null, hours: calculateNetHours(tc, ruleset, roundingMinutes), missing: false }
    })

  return {
    days,
    workedDays: days.filter(d => d.hours !== null).length,
    totalHours: Math.round(days.reduce((sum, d) => sum + (d.hours ?? 0), 0) * 100) / 100,
    anyMissing: days.some(d => d.missing),
  }
}

// ---------------------------------------------------------------------------
// Loading it. SERVICE ROLE, like the rest of lib/clockSession.ts: the person
// opening a clock link may not be signed in at all, and the unguessable token
// is the authorization. The CALLER has already established who this is — this
// function is only ever handed a crew_member_id that the caller proved.
//
// Explicit column lists, never select('*'): the same convention clockSession
// and bookingInvite follow, and the reason day_rate cannot leak onto a
// crew-facing screen by accident.
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'
import { formatPunchTime } from '@/lib/punches'

export type CrewHoursView = {
  showName: string
  timeZone: string
  hours: CrewHours
}

/**
 * Every day this person holds on this show, with hours.
 *
 * Declined rows are excluded in SQL, the rule lib/timecardFields.ts owns: a
 * declined booking is not one of their days.
 */
export async function loadCrewHours(
  showId: string,
  crewMemberId: string,
  use24Hour = false,
): Promise<CrewHoursView | null> {
  const admin = createAdminClient()

  const [{ data: show }, { data: cards }] = await Promise.all([
    admin.from('shows').select('name, timezone_identifier, organization_id').eq('id', showId).maybeSingle(),
    admin.from('timecards')
      // No day_rate. This screen never shows money.
      .select('id, role, is_travel_day, travel_in_day, travel_out_day, pay_as_half_day, absence, rooms!inner ( name, work_days!inner ( date ) )')
      .eq('show_id', showId).eq('crew_member_id', crewMemberId).neq('booking_status', 'declined'),
  ])
  if (!show) return null

  const [{ data: ruleset }, { data: org }] = await Promise.all([
    admin.from('payroll_rulesets').select('*').eq('show_id', showId).maybeSingle(),
    admin.from('organizations').select('timecard_rounding_minutes').eq('id', show.organization_id).maybeSingle(),
  ])

  const ids = (cards ?? []).map((t: any) => t.id as string)
  const { data: punches } = ids.length
    ? await admin.from('punches').select('id, timecard_id, punch_type, punched_at').in('timecard_id', ids)
    : { data: [] as any[] }

  const timeZone = show.timezone_identifier || 'America/Chicago'
  const input: CrewHoursInput[] = (cards ?? []).map((t: any) => {
    const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    return {
      date: (wd?.date as string) ?? '',
      room: (room?.name as string) ?? 'Room',
      role: t.role ?? null,
      timecard: {
        id: t.id, crew_member_id: crewMemberId, day_rate: 0,
        is_travel_day: t.is_travel_day === true,
        travel_in_day: t.travel_in_day === true,
        travel_out_day: t.travel_out_day === true,
        pay_as_half_day: t.pay_as_half_day === true,
        absence: t.absence ?? null,
        punches: (punches ?? []).filter((p: any) => p.timecard_id === t.id),
      },
    }
  }).filter(r => r.date)

  return {
    showName: show.name as string,
    timeZone,
    hours: summarizeCrewHours(
      input,
      (ruleset ?? {}) as PayrollRuleset,
      org?.timecard_rounding_minutes ?? 1,
      iso => formatPunchTime(iso, timeZone, use24Hour),
    ),
  }
}
