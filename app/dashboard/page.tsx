import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NewShowModal from '@/components/NewShowModal'
import ArchiveShowButton from '@/components/ArchiveShowButton'
import Link from 'next/link'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  const { archived } = await searchParams
  const showingArchived = archived === '1'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-8 text-center shadow-xl">
          <h1 className="text-2xl font-bold text-white mb-2">Almost there</h1>
          <p className="text-zinc-400 text-sm">
            Your account isn't linked to an organization yet. If you were expecting an invite, check your email, or reach out to whoever invited you.
          </p>
        </div>
      </div>
    )
  }

  const { data: allShows } = await supabase
    .from('shows')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('start_date', { ascending: false })

  const shows = (allShows || []).filter(s => !!s.archived === showingArchived)
  const archivedCount = (allShows || []).filter(s => s.archived).length

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Shows</h1>
        <NewShowModal organizationId={profile.organization_id} />
      </div>

      <div className="flex gap-2 mb-6">
        <Link
          href="?archived=0"
          className={`rounded-full px-4 py-2 text-sm font-medium ${!showingArchived ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400'}`}
        >
          Active
        </Link>
        <Link
          href="?archived=1"
          className={`rounded-full px-4 py-2 text-sm font-medium ${showingArchived ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400'}`}
        >
          Archived{archivedCount > 0 && ` (${archivedCount})`}
        </Link>
      </div>

      {shows.length === 0 ? (
        <p className="text-zinc-500">
          {showingArchived ? 'No archived shows.' : 'No shows yet. Create your first one to get started.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shows.map(show => (
            <div key={show.id} className="relative">
              <Link
                href={`/dashboard/shows/${show.id}`}
                className="block rounded-2xl bg-zinc-900 p-6 shadow-xl transition hover:bg-zinc-800"
              >
                <h2 className="text-xl font-bold text-white mb-1 pr-20">{show.name}</h2>
                <p className="text-sm text-zinc-400">
                  {new Date(show.start_date).toLocaleDateString()} – {new Date(show.end_date).toLocaleDateString()}
                </p>
                {show.venue && <p className="text-sm text-zinc-500 mt-1">{show.venue}</p>}
              </Link>
              {profile.can_archive_shows && (
                <ArchiveShowButton showId={show.id} archived={!!show.archived} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
