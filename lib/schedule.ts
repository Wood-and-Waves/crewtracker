// Reading bookings ACROSS shows, for the schedule screen.
//
// Plain module — no 'use client'. The server-rendered schedule page imports it,
// and StaffRoomModal (a client component) will import it too for the cross-show
// staffing warning. Exporting non-component values from a 'use client' file to a
// Server Component silently serialises into a broken reference; see CLAUDE.md
// "Past incidents" (PUNCH_GRID_COLS).
//
// WHY THIS IS THE AWKWARD QUERY IN THE APP
// ----------------------------------------
// Every other screen starts from a known show and walks DOWN:
//     show -> work_days -> rooms -> timecards -> punches
// The schedule asks the opposite question — "who is working between these two
// dates, across every show" — so it drives from `work_days.date` and joins
// outward. `timecards` carries neither a date nor a show_id, so the date filter
// cannot be applied to the table being selected; it has to be pushed through the
// join with PostgREST's embedded filtering. Migration 0011 added the indexes
// that path needs.
//
// SCOPING IS RLS, NOT CODE. `shows`' existing SELECT policy is
// (can_see_all_shows() OR assigned OR created_by), and it applies through the
// embedded join, so this returns exactly the shows the caller may already see —
// no calendar-specific permission, and no way to widen it by editing this file.

import { todayInZone } from '@/lib/showStatus'
import { addDays } from '@/lib/datetime'
import { liveBookings } from '@/lib/timecardFields'

/** One person, on one show, on one date. The unit the calendar is built from. */
export type ScheduleBooking = {
  timecardId: string
  crewMemberId: string | null
  crewName: string
  role: string | null
  isTravelDay: boolean
  roomId: string
  roomName: string
  date: string
  showId: string
}

/** A show that has at least one day inside the window. One row of the grid. */
export type ScheduleShow = {
  id: string
  name: string
  venue: string | null
  cityState: string | null
  timezone: string
  startDate: string
  endDate: string
  finalizedAt: string | null
  /** date -> day_number, so a cell can link straight to that day of the tracker. */
  dayNumbers: Record<string, number>
  /**
   * date -> the rooms running that day.
   *
   * This is what makes "spots needed" expressible without new schema. A room is
   * created when the show is built; crew attach to rooms. So a room with nobody
   * in it is an unfilled position that already exists in the data — the only
   * sense in which the app can currently say a day is under-staffed.
   */
  roomsByDate: Record<string, { id: string; name: string }[]>
}

// NEVER select('*') on timecards. `authenticated` holds no SELECT grant on
// day_rate — a wildcard returns 42501 for every user including admins. The
// explicit list is also what keeps this screen money-free by construction: the
// schedule has no business showing pay.
export const SCHEDULE_SELECT = `
  id, crew_member_id, crew_member_name, role, is_travel_day,
  rooms!inner (
    id, name,
    work_days!inner (
      date, day_number,
      shows!inner ( id, archived )
    )
  )
`

// PostgREST returns an embedded to-one relationship as an object, but the
// generated types often widen it to an array. Normalising here keeps the casts
// in one place instead of scattered through the components.
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

type MinimalClient = {
  from: (table: string) => any
}

/**
 * Every booking between `start` and `end` inclusive, across all shows the
 * caller can see. Both bounds are bare 'YYYY-MM-DD'.
 *
 * `excludeShowId` exists for the staffing warning, which asks "is this person
 * committed somewhere ELSE" — the current show is not a conflict with itself.
 */
export async function fetchBookings(
  supabase: MinimalClient,
  start: string,
  end: string,
  opts: { excludeShowId?: string } = {},
): Promise<ScheduleBooking[]> {
  // liveBookings drops declined rows. Without it a room whose only person said
  // no still reads as staffed on the calendar, which is the exact question this
  // screen exists to answer. booking_status is deliberately NOT added to
  // SCHEDULE_SELECT — PostgREST filters on unselected columns fine, and no
  // consumer here needs the value.
  const { data, error } = await liveBookings(supabase
    .from('timecards')
    .select(SCHEDULE_SELECT))
    .gte('rooms.work_days.date', start)
    .lte('rooms.work_days.date', end)
    // .not(…, 'is', true), never .eq(…, false): `archived` is nullable, and
    // .eq(false) silently drops every NULL row — which is most of them.
    .not('rooms.work_days.shows.archived', 'is', true)

  if (error) {
    // Surface it. A calendar that silently renders empty on a query error looks
    // exactly like a quiet week, which is the worst possible failure here.
    throw new Error(`Could not load bookings: ${error.message}`)
  }

  const out: ScheduleBooking[] = []
  for (const row of (data ?? []) as any[]) {
    const room = one<any>(row.rooms)
    const workDay = one<any>(room?.work_days)
    const show = one<any>(workDay?.shows)
    if (!room || !workDay || !show) continue
    if (opts.excludeShowId && show.id === opts.excludeShowId) continue

    out.push({
      timecardId: row.id,
      crewMemberId: row.crew_member_id ?? null,
      crewName: row.crew_member_name ?? 'Unnamed',
      role: row.role ?? null,
      isTravelDay: row.is_travel_day === true,
      roomId: room.id,
      roomName: room.name,
      date: workDay.date,
      showId: show.id,
    })
  }
  return out
}

/**
 * The shows to draw as rows: those with at least one work day inside the window.
 *
 * Driven by work_days rather than by start_date/end_date overlap on purpose —
 * work_days is what the tracker actually renders, and a show whose dates say one
 * thing while its days say another should appear where the days are.
 */
export async function fetchScheduleShows(
  supabase: MinimalClient,
  start: string,
  end: string,
): Promise<ScheduleShow[]> {
  const { data, error } = await supabase
    .from('shows')
    .select(`
      id, name, venue, city_state, timezone_identifier, start_date, end_date,
      archived, finalized_at,
      work_days!inner ( date, day_number, rooms ( id, name ) )
    `)
    .gte('work_days.date', start)
    .lte('work_days.date', end)
    .not('archived', 'is', true)
    .order('start_date', { ascending: true })

  if (error) throw new Error(`Could not load shows: ${error.message}`)

  return ((data ?? []) as any[]).map((s) => {
    const dayNumbers: Record<string, number> = {}
    const roomsByDate: Record<string, { id: string; name: string }[]> = {}
    for (const w of (Array.isArray(s.work_days) ? s.work_days : [s.work_days]).filter(Boolean)) {
      dayNumbers[w.date] = w.day_number
      // `rooms` is embedded WITHOUT !inner on purpose: a day whose rooms have
      // not been created yet must still appear as a day the show is running.
      // !inner would silently drop it, which is the opposite of the point.
      roomsByDate[w.date] = (Array.isArray(w.rooms) ? w.rooms : [w.rooms])
        .filter(Boolean)
        .map((r: any) => ({ id: r.id, name: r.name }))
    }
    return {
      id: s.id,
      name: s.name,
      venue: s.venue ?? null,
      cityState: s.city_state ?? null,
      timezone: s.timezone_identifier || 'America/Chicago',
      startDate: s.start_date,
      endDate: s.end_date,
      finalizedAt: s.finalized_at ?? null,
      dayNumbers,
      roomsByDate,
    }
  })
}

/**
 * How well covered one show-day is: crew booked, and how many of its rooms
 * still have nobody in them.
 *
 * This is the schedule's unit of meaning. The screen is an overview, so a cell
 * answers "is this day covered", not "who is on it" — a couple of sampled names
 * implies a precision the cell cannot deliver, and the full list is a click
 * away on the day itself.
 *
 * `roomsUnstaffed` is the closest thing the app can currently say to "spots
 * needed". It is a real signal, not a proxy: somebody created that room because
 * the show needs it covered. It is NOT a headcount target — nothing in the
 * schema yet says a room needs four people rather than one.
 */
export function coverageFor(
  show: ScheduleShow,
  date: string,
  crew: ScheduleBooking[],
): { crewCount: number; roomsTotal: number; roomsStaffed: number; roomsUnstaffed: number } {
  const roomsTotal = (show.roomsByDate[date] ?? []).length
  const roomsStaffed = new Set(crew.map(c => c.roomId)).size
  return {
    crewCount: crew.length,
    roomsTotal,
    roomsStaffed,
    // Never negative: a booking could in principle reference a room the shows
    // query didn't return, and a negative "unstaffed" count would be nonsense.
    roomsUnstaffed: Math.max(0, roomsTotal - roomsStaffed),
  }
}

/** Bookings keyed `${showId}|${date}` — how the grid looks a cell up. */
export function byShowAndDate(bookings: ScheduleBooking[]): Map<string, ScheduleBooking[]> {
  const m = new Map<string, ScheduleBooking[]>()
  for (const b of bookings) {
    const key = `${b.showId}|${b.date}`
    const list = m.get(key)
    if (list) list.push(b)
    else m.set(key, [b])
  }
  // Stable, human order inside a cell. Without this the order is whatever the
  // database returned, which changes between loads and makes the grid flicker.
  for (const list of m.values()) list.sort((a, b) => a.crewName.localeCompare(b.crewName))
  return m
}

/**
 * The identity a person is tracked by across shows.
 *
 * `crew_member_id` when they came from the directory; otherwise their typed
 * name, lowercased. Manually-named crew are real bookings and must still be
 * groupable — but two different people typed identically will merge, which is a
 * limitation of free-text names rather than of this function.
 */
export function crewKey(b: Pick<ScheduleBooking, 'crewMemberId' | 'crewName'>): string {
  return b.crewMemberId ?? `name:${b.crewName.trim().toLowerCase()}`
}

export type ScheduleWindow = { start: string; end: string; days: number }

/**
 * Resolve the visible window from URL params.
 *
 * TIMEZONE: there is deliberately no single "today". Shows run in different
 * zones and genuinely have different current dates, so the default start is the
 * EARLIEST today across the shows in play — that way nothing which is "today
 * somewhere" falls off the left edge. Each row marks its own today separately.
 * Inventing one global today is the bug class this project has shipped twice.
 */
export function resolveWindow(
  params: { start?: string; days?: string },
  zones: string[],
): ScheduleWindow {
  const todays = (zones.length ? zones : ['America/Chicago']).map(todayInZone)
  const earliestToday = todays.sort()[0]

  const start = /^\d{4}-\d{2}-\d{2}$/.test(params.start ?? '')
    ? (params.start as string)
    : earliestToday

  const parsed = Number(params.days)
  const days = Number.isFinite(parsed) && parsed >= 1 && parsed <= 92 ? Math.floor(parsed) : 14

  return { start, end: addDays(start, days - 1), days }
}
