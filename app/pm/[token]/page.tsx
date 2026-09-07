import type { Metadata } from 'next'
import Link from 'next/link'
import { loadPmInvite } from '@/lib/pmInvite'
import { describeShowDates } from '@/lib/pmInviteEmail'
import AcceptPmForm from './AcceptPmForm'
import Card from '@/components/ui/Card'
import Logo from '@/components/Logo'

// The page a production manager lands on from the naming email. Reachable
// signed out (allowlisted in proxy.ts with /api/pm/accept) because the token
// is the authorization — and because the person may well read the email on a
// phone with no session. Accepting is the ONLY thing that grants the show.
//
// Shows what this person needs and nothing else: the company, the show, dates
// and venue, who named them. See lib/pmInvite.ts for the column rule.

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

export default async function PmInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await loadPmInvite(token)

  if (!invite) {
    return (
      <Shell>
        <h1 className="mb-2 text-center text-xl font-bold text-ink">This link isn&apos;t valid</h1>
        <p className="text-center text-sm text-muted">It may have been replaced by a newer invitation. Check with whoever named you.</p>
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

  if (invite.acceptedAt) {
    return (
      <Shell>
        <h1 className="mb-2 text-center text-xl font-bold text-ink">You&apos;re the PM on {invite.showName}</h1>
        <p className="mb-5 text-center text-sm text-muted">Already accepted. It&apos;s in your shows.</p>
        <Link href={`/dashboard/shows/${invite.showId}`} className="block">
          <span className="block w-full rounded-field bg-accent px-4 py-3 text-center text-sm font-semibold uppercase tracking-wide text-accent-ink">Open the show</span>
        </Link>
      </Shell>
    )
  }

  return (
    <Shell>
      <p className="text-center text-sm text-muted">
        {invite.inviterName ? `${invite.inviterName} at ${invite.organizationName}` : invite.organizationName} named you production manager on
      </p>
      <h1 className="mb-1 mt-1 text-center text-2xl font-extrabold text-ink">{invite.showName}</h1>
      <p className="mb-5 text-center text-sm text-muted">
        {describeShowDates(invite.startDate, invite.endDate)}
        {(invite.venue || invite.cityState) ? ` · ${invite.venue || invite.cityState}` : ''}
      </p>
      <p className="mb-5 text-center text-sm text-ink">
        Accept to get the show in your CrewTracker. Until you do, nothing changes on your side.
      </p>
      <AcceptPmForm token={invite.token} />
    </Shell>
  )
}
