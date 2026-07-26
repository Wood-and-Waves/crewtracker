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
}

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
] as const

/**
 * The only column list the app should ever use against `timecards`.
 *
 * There is deliberately no "include the rate" option: rates come from the
 * `timecard_day_rates` view (scripts/sql/rate-views.sql), which checks
 * can_view_pay_rates for the calling user and is the one path that keeps
 * working once the column is revoked from `authenticated`. Merge by timecard id.
 */
export const TIMECARD_SELECT = TIMECARD_FIELDS_NO_RATE.join(', ')

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
