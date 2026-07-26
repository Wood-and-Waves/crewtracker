// What state a show is in, for the badge on its card.
//
// "Active" used to mean nothing more than "not archived", which made a show
// three weeks in the future and one finished last month look identical. All of
// these are derived from data the show already carries — no new columns.
//
// Plain module, no 'use client': used by the server-rendered dashboard.

export type ShowStatus = 'preshow' | 'active' | 'wrapped' | 'finalized' | 'archived'

export type ShowStatusInput = {
  archived?: boolean | null
  finalized_at?: string | null
  start_date: string
  end_date: string
  timezone_identifier?: string | null
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
  if (today < show.start_date) return 'preshow'
  if (today > show.end_date) return 'wrapped'
  return 'active'
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
  preshow:   { label: 'Pre-show',  tone: 'neutral' },
  active:    { label: 'Active',    tone: 'live' },
  wrapped:   { label: 'Wrapped',   tone: 'ot' },
  finalized: { label: 'Finalized', tone: 'good' },
  archived:  { label: 'Archived',  tone: 'neutral' },
}
