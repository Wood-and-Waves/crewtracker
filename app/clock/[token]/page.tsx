import { loadClockView } from '@/lib/clockSession'
import ClockPicker from './ClockPicker'
import ClockPunch from './ClockPunch'
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

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 className="mb-2 text-center text-xl font-bold text-ink">{title}</h1>
      <p className="text-center text-sm text-muted">{body}</p>
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
  searchParams: Promise<{ d?: string }>
}) {
  const { token } = await params
  const { d } = await searchParams
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
  if (view.expired) {
    return <Message
      title="This link has expired"
      body={`${view.showName} has finished. Ask your PM if you still need to change something.`} />
  }
  // Pre-empts the punches_blocked_when_finalized trigger, which the service
  // role does NOT bypass and which would otherwise surface as a raw 500.
  if (view.finalized) {
    return <Message
      title={view.showName}
      body="This show has been closed out, so times can no longer be changed. Talk to your PM." />
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
      />
    </Working>
  )
}
