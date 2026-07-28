// What state a show is in, for the badge on its card.
//
// "Active" used to mean nothing more than "not archived", which made a show
// three weeks in the future and one finished last month look identical. All of
// these are derived from data the show already carries — no new columns.
//
// Plain module, no 'use client': used by the server-rendered dashboard.

export type ShowStatus =
  | 'new' | 'staffing' | 'preshow' | 'active' | 'wrapped' | 'finalized' | 'archived'

export type ShowStatusInput = {
  archived?: boolean | null
  finalized_at?: string | null
  start_date: string
  end_date: string
  timezone_identifier?: string | null
  /**
   * The crew call. Both default to 0, which reads as 'new' — correct for every
   * show created before the call existed, and for one nobody has built yet.
   */
  positionsTotal?: number
  positionsFilled?: number
}

/**
 * Today's calendar date in a named timezone, as 'YYYY-MM-DD'.
 *
 * MUST be derived from the show's timezone, never from UTC or a raw Date: a
 * show's day rolls over at midnight where the show is, not where the PM is
 * sitting. Reading the UTC date rolls to tomorrow during any US evening, which
 * this project has shipped twice already (see CLAUDE.md). 'en-CA' is used
 * because it formats as YYYY-MM-DD, which compares correctly as a plain string
 * against the date columns.
 */
export function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

/**
 * Precedence matters: archiving is a filing decision that outranks everything,
 * and a finalized show stays finalized even after its dates pass. Only when
 * neither applies do the dates decide.
 */
export function showStatus(show: ShowStatusInput, now?: string): ShowStatus {
  if (show.archived) return 'archived'
  if (show.finalized_at) return 'finalized'

  const today = now ?? todayInZone(show.timezone_identifier || 'America/Chicago')
  // Dates decide first once a show has reached them. A show running today is
  // Active whether or not its call was ever finished — "still staffing" is not
  // useful information about something already on site, and a PM opening the
  // tracker needs to see the show's real state, not its paperwork.
  if (today > show.end_date) return 'wrapped'
  if (today >= show.start_date) return 'active'

  // Before it starts, the interesting question is how far along the crewing is.
  const total = show.positionsTotal ?? 0
  const filled = show.positionsFilled ?? 0
  if (total === 0) return 'new'
  if (filled < total) return 'staffing'
  return 'preshow'
}

/**
 * Label and Chip tone per status.
 *
 * `wrapped` — dates are past but no final report has gone out — is the one
 * carrying an implied action, so it gets the amber tone the tracker already
 * uses for "needs attention" rather than a neutral grey.
 */
export const SHOW_STATUS_META: Record<
  ShowStatus,
  { label: string; tone: 'neutral' | 'live' | 'ot' | 'good' | 'danger' }
> = {
  // 'new' and 'staffing' both carry work outstanding, but only one of them is
  // waiting on somebody: a show with no call yet is waiting on whoever builds
  // it, so it stays quiet, while a part-filled call is the amber the app
  // already uses for needs-attention.
  new:       { label: 'New',       tone: 'neutral' },
  staffing:  { label: 'Staffing',  tone: 'ot' },
  preshow:   { label: 'Pre-show',  tone: 'neutral' },
  active:    { label: 'Active',    tone: 'live' },
  wrapped:   { label: 'Wrapped',   tone: 'ot' },
  finalized: { label: 'Finalized', tone: 'good' },
  archived:  { label: 'Archived',  tone: 'neutral' },
}
