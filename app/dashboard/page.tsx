import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling } from '@/lib/session'
import { redirect } from 'next/navigation'
import ShowsListClient, { type ShowRow } from '@/components/ShowsListClient'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { BAND } from '@/lib/panel'
import { cn } from '@/lib/cn'
import { showStatus, SHOW_STATUS_META } from '@/lib/showStatus'
import { summarizeCall } from '@/lib/crewCall'
import { addDays } from '@/lib/datetime'
import { liveBookings } from '@/lib/timecardFields'
import Link from 'next/link'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  const { archived } = await searchParams
  const showingArchived = archived === '1'

  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  if (!user.organizationId) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-8">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Almost there</h1>
          <p className="text-sm text-muted">
            Your account isn&apos;t linked to an organization yet. If you were expecting an invite, check your email, or reach out to whoever invited you.
          </p>
        </Card>
      </div>
    )
  }

  // Scheduling module: without it there are no positions to measure against, so
  // the positions aggregation below is skipped and the Staffing column is
  // dropped. The booked-headcount query stays — knowing how many people are on
  // a show is core tracker information, not scheduling.
  const schedulingOn = canUseScheduling(user)

  // Three independent reads in one round trip instead of three sequential
  // ones. (Their SCOPE — every timecard and position the org has ever created —
  // is a separate problem, tracked as Step 6 of the speed plan.)
  const [{ data: allShows }, { data: callRows }, { data: bookedRows }] = await Promise.all([
    supabase
      .from('shows')
      .select('*')
      .eq('organization_id', user.organizationId)
      .order('start_date', { ascending: false }),
    schedulingOn
      ? supabase
          .from('crew_call_positions')
          .select('id, timecards(booking_status), rooms!inner ( work_days!inner ( date, show_id ) )')
      : Promise.resolve({ data: [] as any[] }),
    liveBookings(supabase
      .from('timecards')
      .select('id, rooms!inner ( work_days!inner ( date, show_id ) )')),
  ])

  const shows = (allShows || []).filter(s => !!s.archived === showingArchived)
  const archivedCount = (allShows || []).filter(s => s.archived).length

  // How far along each show's crewing is, for the New / Staffing / Pre-show
  // distinction on the cards.
  //
  // One query for the whole page rather than one per show: the card list is the
  // first thing anyone sees, and N+1 queries behind it is how a dashboard gets
  // slow quietly. Aggregated here rather than in SQL because PostgREST cannot
  // group, and at beta size the row count is small — worth revisiting with a
  // view if an organization ever carries hundreds of live shows.

  // Dates are carried so peak-per-day can be worked out: the list must report
  // how many PEOPLE a show needs, never the position-row count. A twelve-person
  // show over five days is sixty rows, which is not a number anybody crews
  // against.
  type ShowCall = {
    total: number
    filled: number
    dates: { date: string }[]
    // Per day, so the column can report PEOPLE. Positions are stored per person
    // per day, so a 12-person show over 5 days is 60 rows — the percentage is
    // honest about the whole run, but the fraction beneath it has to be a
    // number of humans or it means nothing to a scheduler.
    byDate: Map<string, { total: number; filled: number }>
  }
  const callByShow = new Map<string, ShowCall>()
  for (const row of (callRows ?? []) as any[]) {
    const room = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    const showId = wd?.show_id
    if (!showId) continue
    const entry: ShowCall = callByShow.get(showId)
      ?? { total: 0, filled: 0, dates: [], byDate: new Map() }
    entry.total += 1
    if (wd.date) entry.dates.push({ date: wd.date })
    // A declined person does not hold their position, so they do not count it
    // as filled — the same rule the database enforces with a partial index.
    const live = (row.timecards ?? []).some((t: any) => t.booking_status !== 'declined')
    if (live) entry.filled += 1
    if (wd.date) {
      const day = entry.byDate.get(wd.date) ?? { total: 0, filled: 0 }
      day.total += 1
      if (live) day.filled += 1
      entry.byDate.set(wd.date, day)
    }
    callByShow.set(showId, entry)
  }

  // People actually booked, independent of whether a call exists.
  //
  // The Crewed column measures the CALL, and a show with crew on it but no call
  // reported "No call yet" — true, and useless: it is how every show worked
  // before the crew call existed, so every historical show reads as empty. The
  // fallback below shows the headcount that is really there.
  // Declined excluded, matching callRows above — the two counters render into
  // the same column, so one filtering and the other not would quietly disagree.

  const bookedByShow = new Map<string, Map<string, number>>()
  for (const row of (bookedRows ?? []) as any[]) {
    const room = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    if (!wd?.show_id || !wd?.date) continue
    const perDay = bookedByShow.get(wd.show_id) ?? new Map<string, number>()
    perDay.set(wd.date, (perDay.get(wd.date) ?? 0) + 1)
    bookedByShow.set(wd.show_id, perDay)
  }

  // Scheduler names, one query for the page. Only the shows on screen are
  // looked up, and only their name is read.
  const schedulerIds = schedulingOn
    ? [...new Set(shows.map(s => s.scheduler_id).filter(Boolean))] as string[]
    : []
  const { data: schedulers } = schedulerIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', schedulerIds)
    : { data: [] }
  const schedulerById = new Map(
    (schedulers ?? []).map((p: any) => [p.id, p.full_name || p.email || null]),
  )

  const rows: ShowRow[] = shows.map(show => {
    const call = callByShow.get(show.id)
    const summary = summarizeCall(call?.dates ?? [])
    const status = showStatus({
      ...show,
      positionsTotal: call?.total ?? 0,
      positionsFilled: call?.filled ?? 0,
    })
    const meta = SHOW_STATUS_META[status]
    // Inclusive day count, from the dates themselves rather than a work_days
    // query — one round trip saved on the first screen anyone sees.
    let dayCount = 1
    for (let d = show.start_date; d < show.end_date; d = addDays(d, 1)) dayCount++
    return {
      id: show.id,
      name: show.name,
      venue: show.venue ?? null,
      cityState: show.city_state ?? null,
      clientCompany: show.client_company ?? null,
      startDate: show.start_date,
      endDate: show.end_date,
      dayCount,
      status,
      statusLabel: meta.label,
      statusTone: meta.tone,
      peakPerDay: summary.peakPerDay,
      // The busiest day decides the headline: it is the day that needs the most
      // people, so it is the one a scheduler is working to.
      peakDayFilled: (() => {
        let best = { total: 0, filled: 0 }
        for (const d of call?.byDate.values() ?? []) if (d.total > best.total) best = d
        return best.filled
      })(),
      bookedPeakPerDay: Math.max(0, ...[...(bookedByShow.get(show.id)?.values() ?? [0])]),
      filled: call?.filled ?? 0,
      total: call?.total ?? 0,
      schedulerName: show.scheduler_id ? schedulerById.get(show.scheduler_id) ?? null : null,
      archived: !!show.archived,
    }
  })

  return (
    <div className="p-6 md:p-10">
      {/* Open Paper masthead: the screen's title block is a full-bleed ink
          band, and the screen's one primary action sits on it. */}
      <div className={cn(BAND, '-mx-6 mb-6 flex items-center justify-between gap-4 px-6 py-4 md:-mx-10 md:px-10')}>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Shows</h1>
        {user.can('can_create_shows') && (
          <Link href="/dashboard/shows/new">
            <Button>+ New Show</Button>
          </Link>
        )}
      </div>

      <div className="mb-6 flex gap-2">
        <Link
          href="?archived=0"
          className={cn(
            'rounded-field px-4 py-2 text-sm font-medium',
            !showingArchived ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink',
          )}
        >
          {/* "Current" rather than "Active": this tab is just not-archived, and
              Active is now one of five real statuses on the cards below. */}
          Current
        </Link>
        <Link
          href="?archived=1"
          className={cn(
            'rounded-field px-4 py-2 text-sm font-medium',
            showingArchived ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink',
          )}
        >
          Archived{archivedCount > 0 && ` · ${archivedCount}`}
        </Link>
      </div>

      {shows.length === 0 ? (
        <p className="text-muted">
          {showingArchived ? 'No archived shows.' : 'No shows yet. Create your first one to get started.'}
        </p>
      ) : (
        <ShowsListClient rows={rows} canArchive={user.can('can_archive_shows')} schedulingEnabled={schedulingOn} />
      )}
    </div>
  )
}
