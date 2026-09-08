import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BAND } from '@/lib/panel'
import NeedsSchedulingList from '@/components/NeedsSchedulingList'
import { fetchSchedulingQueue } from '@/lib/schedulingQueue'
import { cn } from '@/lib/cn'

// THE SCHEDULER'S WORK QUEUE. Shows that were sent to scheduling and still need
// somebody's hands, oldest first. Every row opens that show's Scheduling screen.
//
// THIS SCREEN USED TO CARRY A CHART, AND THE CHART IS GONE (2026-09-08). It was
// a grid of shows down the side and dates across the top, each cell a headcount,
// built before the scheduling queue existed. Three things killed it, and they
// are worth knowing before anybody builds it again:
//
//   * The queue above it does the same job better. The chart made you SPOT an
//     understaffed show; the queue lists the shows that need work and says why.
//   * A headcount could not tell the truth. It counted people booked, not people
//     who had said yes, so a show where nobody had answered looked identical to
//     one fully confirmed — the exact confusion the Scheduling screen exists to
//     end.
//   * It never answered the question its shape implied. "Is Alex free next
//     Tuesday" needs CREW down the side, and Dan's answer to building that was
//     the end of it: "the number of people that would need to be on that sheet
//     would be terrible to look at." A directory of dozens, most of them idle in
//     any given fortnight, is not a chart anybody reads.
//
// Availability at the moment it matters is still checked — FillPositionPicker
// warns when somebody is already booked elsewhere that day, inside this company
// only. That is the useful half, and it lives where the decision is made.

export default async function SchedulePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  // The scheduling module. Hiding the nav item is not a gate — this is, for
  // anyone who kept the URL in a bookmark after their org was switched off.
  if (!canUseScheduling(user)) redirect('/dashboard')

  if (!user.organizationId) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-8">
        <div className="w-full max-w-md p-8 text-center">
          <h1 className="mb-2 text-2xl font-bold text-ink">Almost there</h1>
          <p className="text-sm text-muted">
            Your account isn&apos;t linked to an organization yet.
          </p>
        </div>
      </div>
    )
  }

  // Scoping is RLS: the caller's session decides which sent shows come back, so
  // a scheduler sees the ones they are entitled to and nothing else.
  const supabase = await createClient()
  const queue = await fetchSchedulingQueue(supabase)

  return (
    <div className="p-4 md:p-10">
      <div className={cn(BAND, '-mx-4 mb-5 px-4 py-4 md:-mx-10 md:px-10')}>
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide md:text-3xl">Schedule</h1>
      </div>

      {queue.length === 0 ? (
        // With the chart gone this is the whole screen, so an empty queue has to
        // say what would put something here rather than reading as a fault.
        <p className="py-16 text-center text-sm text-muted">
          Nothing waiting. A show appears here once it has been sent to scheduling
          and still has an open position, a reply to chase, or something to sort out.
        </p>
      ) : (
        <NeedsSchedulingList rows={queue} />
      )}
    </div>
  )
}
