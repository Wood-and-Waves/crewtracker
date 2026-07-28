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
  /** Non-null once the call has been approved and handed to a scheduler. */
  call_approved_at?: string | null
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

  // Nothing to crew: fully filled is ready regardless of who did it, which
  // covers an admin who simply booked everyone themselves.
  if (total > 0 && filled >= total) return 'preshow'

  // STAFFING MEANS HANDED OVER, not merely "a call exists". Since the call is
  // now built during show creation, every show has positions from the moment it
  // exists — so keying off positions alone made 'new' unreachable and marked
  // shows as being staffed while the person who created them was still writing
  // the call. The handoff is the real transition, and it is the one Dan's
  // process turns on: admin builds the call, approves it, and only then does
  // the scheduler start work.
  return show.call_approved_at ? 'staffing' : 'new'
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
  {
    label: string
    tone: 'neutral' | 'live' | 'ot' | 'good' | 'danger' | 'staffing' | 'preshow' | 'archived'
  }
> = {
  // EVERY STATUS IS ITS OWN COLOUR. Three of them shared the neutral grey,
  // which made New, Pre-show and Archived indistinguishable at a glance — the
  // exact thing the badge exists to prevent.
  //
  // The one still on grey is New, and that is deliberate rather than left over:
  // "nothing has happened yet" is the honest neutral state, and giving it a
  // colour would imply it wants something from you.
  //
  // Staffing is not the needs-attention amber: a show being crewed is on track,
  // not a problem, and colouring it like an overdue one is how people learn to
  // ignore the amber that does mean trouble.
  new:       { label: 'New',       tone: 'neutral' },
  staffing:  { label: 'Staffing',  tone: 'staffing' },
  preshow:   { label: 'Pre-show',  tone: 'preshow' },
  // Dan's choice: green for Active, blue for Finalized. Green reading as
  // "go" for the show that is actually happening is the stronger association,
  // and it leaves the calm blue for the state that is simply closed.
  active:    { label: 'Active',    tone: 'good' },
  wrapped:   { label: 'Wrapped',   tone: 'ot' },
  finalized: { label: 'Finalized', tone: 'live' },
  archived:  { label: 'Archived',  tone: 'archived' },
}
