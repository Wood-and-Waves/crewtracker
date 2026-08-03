// Which timecard columns a query should ask for.
//
// `day_rate` is the one piece of a timecard that is permission-controlled
// (profiles.can_view_pay_rates). It is used by exactly three functions in
// lib/payroll.ts — mealPenaltyTotal, travelLegPay and totalPay. Every hours
// calculation (straight time, overtime, double time, net hours) ignores it
// completely.
//
// So any screen that only shows HOURS never needs to fetch it, and several were
// pulling it anyway via `select('*')`. Selecting it deliberately, rather than by
// wildcard, means adding a column to `timecards` can't silently widen what the
// browser receives — and it keeps the eventual column-level lockdown from
// breaking pages that never wanted the rate in the first place.
//
// Plain module, no 'use client': imported by Server Components as well as
// client ones (see CLAUDE.md on the client/server export rule).

/**
 * A timecard as fetched by the app, where `day_rate` is present only when the
 * caller was permitted to ask for it.
 *
 * Needed because supabase-js infers its result type by parsing the select string
 * as a *literal*. A conditional column list can't be a literal, and widening it
 * to `string` makes the client fall back to `GenericStringError` — so the rows
 * have to be cast to a hand-written type. The optional `day_rate` is the honest
 * shape: at runtime the column really is absent for unprivileged callers, which
 * is why every consumer coalesces it with `?? 0`.
 */
export type TimecardRowMaybeRate = {
  id: string
  room_id: string
  crew_member_id: string | null
  crew_member_name: string
  role: string
  is_travel_day: boolean
  travel_in_day: boolean
  travel_out_day: boolean
  pay_as_half_day: boolean
  day_rate?: number | null
  /** Optional because a few call sites select a deliberately narrower list. */
  booking_status?: BookingStatus
}

/** Did they agree to this booking — and nothing else. See BOOKING STATUS below. */
export type BookingStatus = 'pencilled' | 'invited' | 'confirmed' | 'declined'

/** Everything except the permission-controlled rate. */
export const TIMECARD_FIELDS_NO_RATE = [
  'id',
  'room_id',
  'crew_member_id',
  'crew_member_name',
  'role',
  'is_travel_day',
  'travel_in_day',
  'travel_out_day',
  'pay_as_half_day',
  'booking_status',
] as const

/**
 * The only column list the app should ever use against `timecards`.
 *
 * There is deliberately no "include the rate" option: rates come from the
 * `timecard_day_rates` view (scripts/sql/applied/rate-views.sql), which checks
 * can_view_pay_rates for the calling user and is the one path that keeps
 * working once the column is revoked from `authenticated`. Merge by timecard id.
 */
export const TIMECARD_SELECT = TIMECARD_FIELDS_NO_RATE.join(', ')

// BOOKING STATUS — why reads have to filter, and why it happens here
// -------------------------------------------------------------------
// A declined booking KEEPS its timecard row. That is deliberate (migration
// 0012): it records that we asked and they said no, which is what stops a
// scheduler working back down the same list next week. The database enforces
// the other half — a partial unique index lets one LIVE occupant hold a
// position, `where booking_status <> 'declined'` — so a declined person does
// not hold their position and it re-opens.
//
// Nothing taught the READ side that rule, so a decliner rendered as ordinary
// staffed crew on the tracker, in reports, and in the emailed Final Report,
// while the same position also showed as Open. These two helpers exist so the
// rule lives in one place instead of being re-typed at every call site — the
// omission that caused this in the first place.
//
// The filter is applied in SQL rather than JS on purpose: a caller who forgot
// to select `booking_status` would compare `undefined` and silently let
// everything through. `.neq` is safe here because 0012 declares the column
// `not null default 'pencilled'` — this is not the nullable-column trap
// documented in lib/schedule.ts, where `.eq(false)` drops every NULL row.
//
// NOT every timecards query wants this. Write paths that set the status, the
// duplicate-staffing guards (the room/crew unique index has no booking_status
// predicate, so a declined row still occupies that slot), and lib/crew.ts's
// FK-nulling update must all still see declined rows. Those call sites say so
// in a comment rather than routing through here.

/**
 * Every LIVE timecard on these rooms — declined bookings excluded.
 *
 * Throws rather than returning empty on a query error. The failure this guards
 * against is emailing a client a Final Report containing someone who said no;
 * a page that renders blank is a better outcome than one that renders wrong,
 * and silence here would look exactly like a show nobody was booked on.
 */
export async function fetchLiveTimecards<T = TimecardRowMaybeRate>(
  supabase: { from: (t: string) => any },
  roomIds: string[],
  columns: string = TIMECARD_SELECT,
): Promise<T[]> {
  if (roomIds.length === 0) return []
  const { data, error } = await supabase
    .from('timecards')
    .select(columns)
    .neq('booking_status', 'declined')
    .in('room_id', roomIds)
  if (error) throw new Error(`Could not load timecards: ${error.message}`)
  return (data ?? []) as unknown as T[]
}

/**
 * The same rule as a chainable filter, for queries this module can't build —
 * the cross-show schedule and the org-wide booked-crew count, neither of which
 * is shaped by a room id list.
 *
 * Typed as a pass-through: supabase-js overloads `.neq` against the parsed
 * select string, so a structural constraint won't reliably satisfy it. The
 * `any` at the boundary matches fetchShowRates' client parameter below.
 */
export function liveBookings<Q>(query: Q): Q {
  return (query as any).neq('booking_status', 'declined')
}

/**
 * Fetches per-timecard rates for a show and returns them keyed by timecard id.
 * Returns an empty map when the caller can't see rates — the view simply yields
 * no rows, so no permission check is needed here.
 */
export async function fetchShowRates(
  supabase: { from: (t: string) => any },
  showId: string,
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('timecard_day_rates')
    .select('timecard_id, day_rate')
    .eq('show_id', showId)
  return new Map(
    (data || []).map((r: { timecard_id: string; day_rate: number | null }) =>
      [r.timecard_id, Number(r.day_rate) || 0] as const),
  )
}
