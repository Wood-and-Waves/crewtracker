import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BAND } from '@/lib/panel'
import ScheduleGrid from '@/components/ScheduleGrid'
import ScheduleAgenda from '@/components/ScheduleAgenda'
import { fetchBookings, fetchScheduleShows, resolveWindow } from '@/lib/schedule'
import { addDays, dateRange } from '@/lib/datetime'
import { cn } from '@/lib/cn'

// The first screen in the app that looks ACROSS shows.
//
// Everything until now has been scoped to one show, which is why "who is working
// next Tuesday" and "what is Alex on this month" have been unanswerable without
// opening every show in turn. That is the second workflow this app was missing:
// somebody schedules the crew, somebody else tracks their time, and both were
// describing the same rows.
//
// Read-only for now, deliberately. Booking still happens inside a show; this
// links through to it. Looking at real overlapping shows on a grid is what will
// tell us what editing here should do — designing that first would be guessing.
//
// No new permission. `shows`' existing RLS is (can_see_all_shows() OR assigned
// OR created_by) and applies through the embedded joins, so this shows exactly
// what the caller could already reach.

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; days?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
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

  // Which timezones are in play, before deciding what "today" means. Shows run
  // in different zones and have genuinely different current dates, so the window
  // starts at the earliest of them — nothing that is today somewhere should fall
  // off the left edge. See resolveWindow.
  const { data: zoneRows } = await supabase
    .from('shows')
    .select('timezone_identifier')
    .not('archived', 'is', true)

  const zones = [...new Set((zoneRows ?? []).map(r => r.timezone_identifier).filter(Boolean))] as string[]
  const win = resolveWindow(params, zones)
  const dates = dateRange(win.start, win.days)

  const [shows, bookings] = await Promise.all([
    fetchScheduleShows(supabase, win.start, win.end),
    fetchBookings(supabase, win.start, win.end),
  ])

  const link = (start: string, days: number) => `/dashboard/schedule?start=${start}&days=${days}`
  const lengths = [7, 14, 28]

  return (
    <div className="p-4 md:p-10">
      {/* Open Paper masthead. The window controls stay below it, on the paper —
          they are view controls sitting above the content they govern. */}
      <div className={cn(BAND, '-mx-4 mb-5 px-4 py-4 md:-mx-10 md:px-10')}>
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide md:text-3xl">Schedule</h1>
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Window length. Not a dropdown: three fixed choices are faster to hit
              and make the current one visible without opening anything. */}
          <div className="flex overflow-hidden rounded-field border border-line">
            {lengths.map(n => (
              <Link
                key={n}
                href={link(win.start, n)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold transition-colors',
                  win.days === n ? 'bg-accent-wash text-accent' : 'text-muted hover:text-ink',
                )}
              >
                {n}d
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <Link
              href={link(addDays(win.start, -win.days), win.days)}
              aria-label="Previous window"
              className="rounded-field border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
            >
              ‹
            </Link>
            <Link
              href={`/dashboard/schedule?days=${win.days}`}
              className="rounded-field border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-ink"
            >
              Today
            </Link>
            <Link
              href={link(addDays(win.start, win.days), win.days)}
              aria-label="Next window"
              className="rounded-field border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
            >
              ›
            </Link>
          </div>
        </div>
      </div>

      {shows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          No shows running between{' '}
          {new Date(win.start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} and{' '}
          {new Date(win.end + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
        </p>
      ) : (
        <>
          <div className="hidden lg:block">
            <ScheduleGrid shows={shows} bookings={bookings} dates={dates} />
          </div>
          <div className="lg:hidden">
            <ScheduleAgenda shows={shows} bookings={bookings} dates={dates} />
          </div>
        </>
      )}
    </div>
  )
}
