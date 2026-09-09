import { loadClockView } from '@/lib/clockSession'
import ClockPicker from './ClockPicker'
import Link from 'next/link'
import ClockPunch from './ClockPunch'
import CrewHoursList from '@/components/CrewHoursList'
import { loadCrewHours } from '@/lib/crewHours'
import Card from '@/components/ui/Card'
import Logo from '@/components/Logo'
import type { Metadata } from 'next'

// Where a crew member clocks in and out. NO LOGIN.
//
// Allowlisted in proxy.ts alongside /api/clock — forgetting either is the
// 307-to-/login trap that has already caught the keepalive cron and the web
// manifest, and here it would ask crew to sign in to an app they have no
// account for.
//
// ONE ROUTE, TWO BEHAVIOURS, decided by the token (see migration 0018):
//   personal — straight to this person's own day. The normal path, and the one
//              handed out over Slack. Bookmarkable.
//   venue    — the printed QR. Carries no identity, so it asks which room and
//              which name, then trades itself for that person's personal link.
//
// Shows only what this person needs. No rate, no hours total, no other crew's
// times — enforced by explicit column lists in lib/clockSession.ts, because the
// service role bypasses the day_rate lockdown that protects every other read.

// The token sits in the URL path, where it reaches referrer headers, browser
// history and link-scanner logs. Keeping it out of a search index is the least
// that can be done about that.
export const metadata: Metadata = { robots: { index: false, follow: false } }

// A short message (bad link, expired, closed out) is genuinely a little sheet,
// so it keeps the centred Card the other public pages use.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-bg p-4 sm:items-center">
      <Card className="w-full max-w-md p-6">
        <Logo className="mx-auto mb-5 h-10 w-10" />
        {children}
      </Card>
    </div>
  )
}

// The working screens are NOT a sheet. They are the tracker for one person, so
// they get the paper ground and the full width of the phone — the card inset is
// most of why the first cut read "a little small".
function Working({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      {children}
    </div>
  )
}

function Message({ title, body, hoursHref }: { title: string; body: string; hoursHref?: string }) {
  return (
    <Shell>
      <h1 className="mb-2 text-center text-xl font-bold text-ink">{title}</h1>
      <p className="text-center text-sm text-muted">{body}</p>
      {/* THE WAY IN, once the punch screen is gone (found by Dan, 2026-09-09,
          on the first show he tried it on). Their hours outlive the show, but
          the only door to them was the toggle ON the punch screen — which is
          exactly the screen these messages replace. So this dead end is where
          the link has to be, and it is the one thing still worth doing here. */}
      {hoursHref && (
        <p className="mt-5 text-center">
          <Link
            href={hoursHref}
            className="inline-block border-2 border-ink px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink"
          >
            See your hours
          </Link>
        </p>
      )}
    </Shell>
  )
}

export default async function ClockPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  // ?d=YYYY-MM-DD picks the show day. Validated in loadClockView against the
  // show's actual work days, so a hand-edited value falls back to today rather
  // than reaching anything.
  // ?v=hours is the second view: their whole run with hours, instead of one
  // day's punch grid (Dan, 2026-09-08).
  searchParams: Promise<{ d?: string; v?: string }>
}) {
  const { token } = await params
  const { d, v } = await searchParams
  const view = await loadClockView(token, d)

  if (!view) {
    return <Message
      title="This link isn’t valid"
      body="Check with whoever sent it to you — it may have been replaced." />
  }
  // Order matters: revoked is a deliberate act by a PM and outranks expiry,
  // which is just time passing.
  if (view.revoked) {
    return <Message
      title="This link has been turned off"
      body="Ask your PM for a new one." />
  }
  // THEIR OWN HOURS SURVIVE THE SHOW (Dan, 2026-09-09). Reading is not
  // changing: expiry and the finalize lock exist to stop somebody EDITING
  // times afterwards, and nobody asks "what did I work?" during the load-in —
  // they ask the week after, checking their pay. So this sits above both
  // gates and below `revoked`, which is a PM deliberately killing a link and
  // still means dead.
  //
  // Read-only by construction: the list renders numbers and, once the show is
  // over, links to nothing.
  if (v === 'hours' && view.me) {
    const hours = await loadCrewHours(view.showId, view.me.crewMemberId)
    if (hours) {
      const closed = view.expired || view.finalized
      return (
        <Working>
          <CrewHoursList
            showName={hours.showName}
            hours={hours.hours}
            dayHref={closed ? null : (date => `/clock/${view.token}?d=${date}`)}
            todayHref={closed ? null : `/clock/${view.token}`}
          />
        </Working>
      )
    }
  }

  // FINALIZED BEFORE EXPIRED (Dan, 2026-09-09: "The link isn't expired. We need
  // new language. This shows hours have been finalized"). Both are true of a
  // show that has finished AND been signed off, and expiry was winning — so
  // crew were told a token had lapsed, which is the app's business, when what
  // had actually happened was their hours being made final, which is theirs.
  //
  // This also pre-empts the punches_blocked_when_finalized trigger, which the
  // service role does NOT bypass and which would otherwise surface as a raw 500.
  if (view.finalized) {
    return <Message
      title="Your hours are final"
      body={`${view.showName} has been closed out and signed off. If something does not look right, talk to your PM.`}
      hoursHref={view.me ? `/clock/${view.token}?v=hours` : undefined} />
  }
  // Finished, but nobody has signed the hours off yet — so they are not final,
  // and saying so would be a lie. All that has ended is the punching.
  if (view.expired) {
    return <Message
      title={`${view.showName} has finished`}
      body="Clocking in and out is closed. Talk to your PM if something still needs changing."
      hoursHref={view.me ? `/clock/${view.token}?v=hours` : undefined} />
  }

  if (view.kind === 'venue') {
    if (view.roster.length === 0) {
      return <Message
        title={view.showName}
        body="Nothing is scheduled on this show today." />
    }
    return (
      <Working>
        <ClockPicker
          token={view.token}
          showName={view.showName}
          venue={view.venue}
          roster={view.roster}
        />
      </Working>
    )
  }

  // Not staffed on the SELECTED day. Still render the punch screen, so the day
  // arrows remain reachable — an empty state with no way back would strand
  // somebody who stepped onto a day off.
  return (
    <Working>
      <ClockPunch
        // Keyed on the day, and that is load-bearing. ClockPunch seeds its
        // punch rows into useState, which initialises ONCE — so navigating
        // days reused the instance, refreshed the header from props, and left
        // the cells holding the PREVIOUS day's timecard ids. Punching then
        // silently wrote to the wrong day. The key forces a fresh mount, so
        // state can never outlive the day it belongs to.
        key={view.selectedDate}
        token={view.token}
        showName={view.showName}
        venue={view.venue}
        timeZone={view.timeZone}
        roundingMinutes={view.roundingMinutes}
        crewName={view.me?.name ?? ''}
        selectedDate={view.selectedDate}
        today={view.today}
        days={view.days}
        assignments={view.me?.assignments ?? []}
        // Personal links only: a venue QR has not identified anybody yet.
        hoursHref={view.me ? `/clock/${view.token}?v=hours` : undefined}
      />
    </Working>
  )
}
