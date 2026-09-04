/**
 * Crew clock links — the URL shape, the expiry rule, and the paste-ready list.
 *
 * Pure on purpose: no `'use client'`, no Supabase, and its one import is
 * lib/datetime.ts, which is equally plain. The panel, the print sheet, the
 * public page and the tests all share these, and a plain module crosses the
 * server/client boundary safely (the PUNCH_GRID_COLS incident: a non-component
 * export from a `'use client'` file is silently mangled when a Server
 * Component imports it).
 */
import { addDays, zonedWallTimeToUtc } from '@/lib/datetime'

/** One person's link, as the generation panel needs it. */
export type ClockLinkRow = {
  crewMemberId: string
  name: string
  token: string | null
  revokedAt: string | null
}

/**
 * The public URL. `origin` comes from `window.location.origin` at the call
 * site, exactly as the auth redirects do, so nothing is pinned to a domain and
 * a preview deploy hands out preview links rather than production ones.
 */
export function clockUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/clock/${token}`
}

/**
 * Expires at 6am, in the SHOW's timezone, the morning after the show ends.
 *
 * Two decisions here, both load-bearing.
 *
 * 1. Not the booking-invite rule (`min(30 days, day after the show)`). A
 *    booking request is answered once, soon, so a 30-day cap usefully limits
 *    the blast radius of a leaked link. A clock link is used every day OF the
 *    show, so the same cap would expire every link for a show booked two
 *    months out before anybody ever clocked in.
 *
 * 2. The show's timezone, never the server's. `new Date(endDate + 'T00:00:00')`
 *    reads as LOCAL midnight, so the same code produces a different instant on
 *    a developer's Mac and on Vercel — and in UTC it lands mid-afternoon on the
 *    show's last day in California, expiring every link before wrap. That is
 *    the third outing of a bug this app has already shipped twice (the
 *    tracker's UTC "today" and TimeEntryModal's browser "today"), so it goes
 *    through zonedWallTimeToUtc like every other date in the app.
 *
 * 6am rather than midnight so a 3am strike on the last night still works.
 */
export function clockLinkExpiry(endDate: string, timeZone: string): string {
  return zonedWallTimeToUtc(addDays(endDate, 1), '06:00', timeZone).toISOString()
}

/**
 * The block a PM pastes into Slack.
 *
 * Plain text with bare URLs — Slack auto-links those. Deliberately no markdown:
 * Slack does not render `[text](url)`, so it would paste as literal brackets.
 *
 * People with no link (never minted, or revoked) are listed under a separate
 * heading rather than silently dropped, so a PM copying this can see who is
 * missing instead of discovering it when somebody cannot clock in.
 */
export function buildSlackList(showName: string, rows: ClockLinkRow[], origin: string): string {
  const live = rows.filter(r => r.token && !r.revokedAt)
  const missing = rows.filter(r => !r.token || r.revokedAt)

  let out = `${showName} — clock in and out here:\n\n`
  for (const r of live) out += `${r.name}: ${clockUrl(origin, r.token!)}\n`
  out += `\nThis link is yours — bookmark it, and use it every day of the show.\n`

  if (missing.length > 0) {
    out += `\nNo link yet: ${missing.map(r => r.name).join(', ')}\n`
  }
  return out
}
