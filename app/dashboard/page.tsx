import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import NewShowModal from '@/components/NewShowModal'
import ArchiveShowButton from '@/components/ArchiveShowButton'
import Card from '@/components/ui/Card'
import Chip from '@/components/ui/Chip'
import { cn } from '@/lib/cn'
import { showStatus, SHOW_STATUS_META } from '@/lib/showStatus'
import Link from 'next/link'

// start_date/end_date are Postgres `date` columns, so they arrive as bare
// 'YYYY-MM-DD'. A date-only string parses as UTC midnight, which renders as the
// PREVIOUS day anywhere west of Greenwich; appending T00:00:00 makes it local
// midnight and keeps the calendar date intact. Same pattern as the tracker,
// reports, PDF and CSV.
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

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

  const { data: allShows } = await supabase
    .from('shows')
    .select('*')
    .eq('organization_id', user.organizationId)
    .order('start_date', { ascending: false })

  const shows = (allShows || []).filter(s => !!s.archived === showingArchived)
  const archivedCount = (allShows || []).filter(s => s.archived).length

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Shows</h1>
        <NewShowModal organizationId={user.organizationId} />
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shows.map(show => (
            <div key={show.id} className="relative">
              <Link href={`/dashboard/shows/${show.id}`} className="block">
                <Card interactive className="p-6">
                  <h2 className="mb-1 pr-20 text-xl font-bold text-ink">{show.name}</h2>
                  <p className="text-sm text-muted">
                    {fmtDate(show.start_date)} – {fmtDate(show.end_date)}
                  </p>
                  {/* iOS shows city/state on the list row alongside the venue. */}
                  {(show.venue || show.city_state) && (
                    <p className="mt-1 text-sm text-muted">
                      {[show.venue, show.city_state].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="mt-4">
                    {(() => {
                      const status = showStatus(show)
                      const { label, tone } = SHOW_STATUS_META[status]
                      return (
                        <Chip tone={tone}>
                          {status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                          {label}
                        </Chip>
                      )
                    })()}
                  </div>
                </Card>
              </Link>
              {user.can('can_archive_shows') && (
                <ArchiveShowButton showId={show.id} archived={!!show.archived} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
