import type { Metadata } from 'next'
import Link from 'next/link'
import { loadPmInvite, acceptPmInvite, declinePmInvite } from '@/lib/pmInvite'
import { describeShowDates } from '@/lib/pmInviteEmail'
import { dayLabel } from '@/lib/dayActivities'
import AcceptPmForm from './AcceptPmForm'
import Card from '@/components/ui/Card'
import Logo from '@/components/Logo'

// The page a production manager lands on from the naming email. Reachable
// signed out (allowlisted in proxy.ts with /api/pm/*) because the token is the
// authorization — and because the person may well read the email on a phone
// with no session.
//
// THE EMAILED LINK ACCEPTS (2026-09-08, Dan: "I would like the accept from the
// email to be an actual accept"). It carries `?accept=1`, this page performs
// the acceptance before it renders, and what opens is a confirmation: you have
// the show, here is what it is, and here is how to hand it back. One tap, the
// way Planning Center does it.
//
// So the page has two faces. With the show accepted it says so and offers
// DECLINE, which undoes everything the acceptance did and emails whoever named
// them, with a note if they leave one. Without (a bookmark, a link opened by
// hand) it is the older invitation page, with Accept and Decline side by side.
//
// Shows what this person needs and nothing else: the company, the show, its
// dates, venue and what happens on each day, and who named them. No crew, no
// money — see lib/pmInvite.ts for the column rule.

export const metadata: Metadata = { robots: { index: false, follow: false } }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-md p-7">
        <Logo className="mx-auto mb-5 h-10 w-10" />
        {children}
      </Card>
    </div>
  )
}

function dayLine(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export default async function PmInvitePage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ accept?: string; decline?: string }>
}) {
  const { token } = await params
  const { accept, decline } = await searchParams

  // The link's whole job. Idempotent, so a refresh — or a mail scanner that
  // fetched the URL before the person read it — changes nothing the second
  // time, and either way the page below can hand the show straight back.
  // EITHER BUTTON IS THE ANSWER (Dan, 2026-09-08: "A click from the email is
  // definitive. There can be a reversal, but a decline click in the email
  // should not bring up another decline button"). So both answer here, before
  // the page renders, and what opens says what was recorded. The way back is a
  // button on that page — accepting after a decline re-points the show at them
  // (0039), and the note can still be added afterwards.
  if (accept === '1') await acceptPmInvite(token)
  if (decline === '1') await declinePmInvite(token)

  const invite = await loadPmInvite(token)

  if (!invite) {
    return (
      <Shell>
        <h1 className="mb-2 text-center text-xl font-bold text-ink">This link isn&apos;t valid</h1>
        <p className="text-center text-sm text-muted">
          It may have been declined, or replaced by a newer invitation. Check with whoever invited you.
        </p>
      </Shell>
    )
  }

  if (invite.replaced) {
    return (
      <Shell>
        <h1 className="mb-2 text-center text-xl font-bold text-ink">This invitation has been replaced</h1>
        <p className="text-center text-sm text-muted">{invite.showName} has since been given to somebody else. Check with {invite.inviterName || invite.organizationName}.</p>
      </Shell>
    )
  }

  const where = invite.venue || invite.cityState
  // INVITED, never "named" (Dan, 2026-09-08/09) — the same word the email now
  // uses, and the honest one: being named grants nothing until this page is
  // used to accept.
  // The COMPANY does the inviting. The individual who pressed the button was
  // named here until 2026-09-09 ("Dan Smith at Wood & Waves Productions has
  // invited you") — Dan cut it: a PM works for the company, and a personal name
  // dates the page the moment that person leaves.

  // What the show IS: the run, day by day. A PM deciding whether they can do a
  // show asks "which days, and what are they" before anything else.
  const runDetail = invite.days.length > 0 && (
    <div className="mb-5 border-y border-line py-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {invite.days.length} {invite.days.length === 1 ? 'day' : 'days'}
      </p>
      <ul className="flex flex-col gap-1">
        {invite.days.map(d => (
          <li key={d.date} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink">{dayLine(d.date)}</span>
            <span className="text-right text-xs text-muted">{dayLabel(d.activities) ?? '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )

  if (invite.declinedAt) {
    return (
      <Shell>
        <p className="text-center text-sm text-muted">You&rsquo;ve declined</p>
        <h1 className="mb-1 mt-1 text-center text-2xl font-extrabold text-ink">{invite.showName}</h1>
        <p className="mb-5 text-center text-sm text-muted">
          {describeShowDates(invite.startDate, invite.endDate)}{where ? ` · ${where}` : ''}
        </p>
        <AcceptPmForm token={invite.token} declined note={invite.declinedNote} />
      </Shell>
    )
  }

  if (invite.acceptedAt) {
    return (
      <Shell>
        <p className="text-center text-sm text-muted">Thanks — you&rsquo;re the production manager on</p>
        <h1 className="mb-1 mt-1 text-center text-2xl font-extrabold text-ink">{invite.showName}</h1>
        <p className="mb-5 text-center text-sm text-muted">
          {describeShowDates(invite.startDate, invite.endDate)}{where ? ` · ${where}` : ''}
        </p>
        {runDetail}
        <Link href={`/dashboard/shows/${invite.showId}`} className="block">
          <span className="block w-full rounded-field bg-accent px-4 py-3 text-center text-sm font-semibold uppercase tracking-wide text-accent-ink">
            Open the show
          </span>
        </Link>
      </Shell>
    )
  }

  return (
    <Shell>
      <p className="text-center text-sm text-muted">
        {invite.organizationName} has invited you to be the production manager on
      </p>
      <h1 className="mb-1 mt-1 text-center text-2xl font-extrabold text-ink">{invite.showName}</h1>
      <p className="mb-5 text-center text-sm text-muted">
        {describeShowDates(invite.startDate, invite.endDate)}{where ? ` · ${where}` : ''}
      </p>
      {runDetail}
      <AcceptPmForm token={invite.token} />
    </Shell>
  )
}
