import Link from 'next/link'
import { cn } from '@/lib/cn'

// The four screens of a show, on every one of them.
//
// Dan, 2026-09-17: "When I am in edit show or scheduling, the only place I can
// go is back to the tracker then to the edit show or scheduling. How can we
// make direct links while in these pages?" A show has four screens and only the
// TRACKER carried links to the others, so it was a hub everything routed
// through — Edit Show to Scheduling was two hops through a screen you did not
// want, and the one link that did exist was a muted sentence buried down the
// page.
//
// This replaces the "← Back to …" line rather than sitting beside it: the
// tracker is one of the four, so a back link to it would say the same thing
// twice. "Shows" keeps the way out to the list.
//
// THE CURRENT SCREEN IS NOT A LINK. A link to the page you are already on is
// noise, and it is the one item that has to be readable as "you are here".
//
// ON ALL FOUR, THE TRACKER INCLUDED (2026-10-15). It was left off the tracker
// at first — the desktop header already carried the same places as ghost
// buttons beside Add Room, and the phone header as icons — and that turned
// out to be the problem rather than a saving: the menu sat ABOVE the title on
// three screens and BELOW it, in a different shape with different words, on the
// fourth (Dan: "The menu moves between Tracker, Scheduling and Edit show and
// reports. It's a bit confusing"). Now it is the first line of every show
// screen, in the same place, and the screen you are on is the one underlined.
//
// prefetch={false} on every link: the tracker measured 23 background renders
// per load from Link prefetches (2026-10-04), and a prefetch carries nothing
// for a dynamic route anyway. Harmless on the other three screens.
//
// ON A PHONE THE WAY OUT TAKES ITS OWN ROW. Measured at 375px: the four tabs
// are 277px with their gaps and fit the 327px row; the back link and divider
// are what pushed the line to 361px, which wrapped REPORTS alone onto a second
// line. So below `sm` the back link spans the row and the divider is hidden —
// still two lines, but the break is the same on every phone and every screen
// rather than wherever the width happened to fall.

export type ShowScreen = 'tracker' | 'schedule' | 'edit' | 'reports'

export default function ShowNav({
  showId, current, schedulingOn = false,
}: {
  showId: string
  current: ShowScreen
  /** canUseScheduling(user) — the module is off for most companies. */
  schedulingOn?: boolean
}) {
  const items: { key: ShowScreen; label: string; href: string }[] = [
    { key: 'tracker', label: 'Tracker', href: `/dashboard/shows/${showId}` },
    ...(schedulingOn
      ? [{ key: 'schedule' as const, label: 'Scheduling', href: `/dashboard/shows/${showId}/schedule` }]
      : []),
    { key: 'edit', label: 'Edit Show', href: `/dashboard/shows/${showId}/edit` },
    { key: 'reports', label: 'Reports', href: `/dashboard/shows/${showId}/reports` },
  ]

  const label = 'font-display text-[12px] font-semibold uppercase tracking-[0.1em]'

  return (
    <nav aria-label="This show" className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4">
      <Link prefetch={false} href="/dashboard" className="basis-full text-sm text-muted hover:text-ink sm:basis-auto">← Shows</Link>
      <span aria-hidden className="hidden h-3.5 w-px bg-line sm:block" />
      {items.map(item =>
        item.key === current ? (
          <span key={item.key} aria-current="page" className={cn(label, 'border-b-2 border-ink pb-0.5 text-ink')}>
            {item.label}
          </span>
        ) : (
          <Link key={item.key} prefetch={false} href={item.href} className={cn(label, 'border-b-2 border-transparent pb-0.5 text-muted hover:text-ink')}>
            {item.label}
          </Link>
        ),
      )}
    </nav>
  )
}
