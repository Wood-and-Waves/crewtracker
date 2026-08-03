import { loadBookingInvite } from '@/lib/bookingInvite'
import { describeDayLines } from '@/lib/bookingEmail'
import BookingResponseForm from './BookingResponseForm'
import Card from '@/components/ui/Card'
import Logo from '@/components/Logo'

// The page a crew member lands on from a booking request. NO LOGIN.
//
// Allowlisted in proxy.ts alongside /api/bookings/respond. Forgetting that is
// the 307-to-/login trap that has already caught the keepalive cron and the web
// manifest, and here it would mean crew being asked to sign in to an app they
// have no account for.
//
// Shows only what this person needs: who is asking, the show, where, their own
// role and dates. No rate, no other crew, no internal show notes — see the
// header of lib/bookingInvite.ts for why that is enforced by column lists here
// rather than by the database.

// The local fmtDate ("Saturday, July 25") is gone: dates now come from
// describeDayLines, which is also what builds the email and the SMS. That makes
// them shorter here ("Sat, Jul 25") and, more importantly, identical to the
// message this person was actually sent.

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

export default async function BookingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const invite = await loadBookingInvite(token)

  if (!invite) {
    return (
      <Shell>
        <h1 className="mb-2 text-center text-xl font-bold text-ink">This link isn&apos;t valid</h1>
        <p className="text-center text-sm text-muted">
          It may have been replaced by a newer request. Check with whoever booked you.
        </p>
      </Shell>
    )
  }

  const expired = new Date(invite.expiresAt) < new Date()

  if (invite.finalized) {
    return (
      <Shell>
        <h1 className="mb-2 text-center text-xl font-bold text-ink">{invite.showName}</h1>
        <p className="text-center text-sm text-muted">
          This show has been closed out, so it can no longer be changed. Please contact
          whoever booked you.
        </p>
      </Shell>
    )
  }

  if (expired) {
    return (
      <Shell>
        <h1 className="mb-2 text-center text-xl font-bold text-ink">This request has expired</h1>
        <p className="text-center text-sm text-muted">
          Please contact whoever booked you for {invite.showName}.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <p className="text-center text-sm text-muted">{invite.organizationName} would like to book you for</p>
      <h1 className="mb-1 mt-1 text-center text-2xl font-extrabold text-ink">{invite.showName}</h1>
      {(invite.venue || invite.cityState) && (
        <p className="mb-5 text-center text-sm text-muted">{invite.venue || invite.cityState}</p>
      )}

      <div className="mb-5 rounded-field border border-line bg-surface-2 px-4 py-3">
        <p className="text-sm font-semibold text-ink">{invite.crewName}</p>
        {invite.role && <p className="text-xs text-muted">{invite.role}</p>}
        {/* Each day says what it IS. A range alone cannot distinguish a
            travel day from a full day on site, and that is the difference
            between being able to answer and having to ring someone. */}
        {/* Built by describeDayLines, the same function behind the email and
            the SMS, so what this page says always matches what they were sent. */}
        <ul className="mt-2 space-y-0.5">
          {describeDayLines(invite.days).map(l => (
            <li key={l.date} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink">{l.date}</span>
              {(l.production || l.you) && (
                <span className="shrink-0 text-xs text-muted">
                  {[l.production, l.you].filter(Boolean).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
        {invite.days.length === 0 && (
          <p className="mt-2 text-sm text-muted">Dates to be confirmed.</p>
        )}
      </div>

      <BookingResponseForm
        token={invite.token}
        alreadyResponded={invite.response}
        respondedAt={invite.respondedAt}
      />
    </Shell>
  )
}
