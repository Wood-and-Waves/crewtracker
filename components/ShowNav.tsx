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
// Not on the tracker itself: its desktop header already carries this cluster
// beside Add Room, and its phone layout carries the same places as icons in a
// deliberately compact strip. Show day is not the screen to redesign for the
// sake of symmetry.

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
    <nav aria-label="This show" className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Shows</Link>
      <span aria-hidden className="h-3.5 w-px bg-line" />
      {items.map(item =>
        item.key === current ? (
          <span key={item.key} aria-current="page" className={cn(label, 'border-b-2 border-ink pb-0.5 text-ink')}>
            {item.label}
          </span>
        ) : (
          <Link key={item.key} href={item.href} className={cn(label, 'border-b-2 border-transparent pb-0.5 text-muted hover:text-ink')}>
            {item.label}
          </Link>
        ),
      )}
    </nav>
  )
}
