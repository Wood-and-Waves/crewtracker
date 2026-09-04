import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import CrewClockSign from '@/components/CrewClockSign'

/**
 * The printable venue QR. Split out of Edit Show because a sheet you tape to a
 * road case wants the whole page, and AppShell's chrome is print:hidden so
 * what comes out of the printer is just the sign.
 */
export default async function ClockPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [user, { data: show }] = await Promise.all([
    getCurrentUser(),
    supabase.from('shows').select('name, venue, city_state').eq('id', id).single(),
  ])
  if (!user) redirect('/login')
  // Same permission that mints the link. A read-only member has no business
  // printing a credential.
  if (!user.can('can_edit_timecards')) notFound()
  if (!show) notFound()

  const { data: link } = await supabase
    .from('clock_links')
    .select('token, revoked_at')
    .eq('show_id', id)
    .is('crew_member_id', null)
    .maybeSingle()

  if (!link || link.revoked_at) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="font-display text-2xl font-bold uppercase text-ink">No venue QR</h1>
        <p className="mt-2 text-sm text-muted">
          {link ? 'This show’s venue QR has been revoked.' : 'This show has no venue QR yet.'}{' '}
          Create one from Crew Clock on the Edit Show screen.
        </p>
      </div>
    )
  }

  return (
    <CrewClockSign
      token={link.token}
      showName={show.name}
      venue={show.venue || show.city_state || null}
    />
  )
}
