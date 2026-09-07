import Link from 'next/link'
import { loadClockViewForProfile } from '@/lib/clockSession'
import ClockPunch from '@/app/clock/[token]/ClockPunch'

// What a CREW-SIDE login sees when they open a show: the crew clock, for one
// person, reached from a login instead of a link (Section 3, 2026-09-06).
// Same component the link renders; the only differences are the endpoint it
// posts to (/api/clock/punch-me, session-authorised) and that there is no
// expiry or revocation — you are staffed or you are not.
export default async function CrewShowScreen({
  showId, profileId, day,
}: {
  showId: string
  profileId: string
  /** ?d=YYYY-MM-DD, validated against the show's days by the loader. */
  day?: string
}) {
  const view = await loadClockViewForProfile(showId, profileId, day)

  if (!view || !view.me) {
    return (
      <div className="p-6 md:p-10">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
        <p className="mt-4 text-sm text-muted">You aren’t staffed on this show.</p>
      </div>
    )
  }

  if (view.finalized) {
    return (
      <div className="p-6 md:p-10">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
        <h1 className="mt-4 font-display text-2xl font-bold uppercase tracking-wide text-ink">{view.showName}</h1>
        <p className="mt-2 text-sm text-muted">This show has been closed out, so times can no longer be changed.</p>
      </div>
    )
  }

  return (
    <ClockPunch
      // Re-seeds the rows when the day changes — load-bearing, see CLAUDE.md.
      key={view.selectedDate}
      endpoint="/api/clock/punch-me"
      showId={view.showId}
      showName={view.showName}
      venue={view.venue}
      crewName={view.me.name}
      timeZone={view.timeZone}
      roundingMinutes={view.roundingMinutes}
      selectedDate={view.selectedDate}
      today={view.today}
      days={view.days}
      assignments={view.me.assignments}
    />
  )
}
