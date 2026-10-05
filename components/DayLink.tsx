'use client'

import { useEffect } from 'react'
import Link, { useLinkStatus } from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'

// The tracker's day arrows, on both trees. Two things a plain Link did not do
// (2026-10-05, Dan: "so much hesitation while switching between days"):
//
// PREFETCH. A day switch is a full server render of the tracker (~0.5 s
// warm, more on venue wifi) and the old screen sat there until it landed. The
// two neighbouring days are now rendered in the background when a day opens,
// so the arrow lands at once. It is router.prefetch from an effect rather than
// the Link's own prefetch, because the Link re-prefetches the moment a
// router.refresh() lands — and the tracker refreshes after every punch, which
// made each punch three server renders racing each other (measured
// 2026-10-05: the refresh that paints the punch took 700 ms instead of 400).
// The effect re-prefetches too, but two seconds AFTER the refresh, from
// onInvalidate. Two background renders per day opened — not the 23 the old
// prefetch-everything produced, which is why every OTHER link on the tracker
// stays prefetch={false}.
//
// PENDING. When the prefetch has not landed (or a refresh has dropped it),
// the arrow dims and pulses while the day loads, so the tap is seen to have
// taken. useLinkStatus only works from inside the Link, hence the inner Glyph.

function Glyph({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  return (
    <span className={cn('transition-opacity', pending && 'animate-pulse opacity-40')}>{children}</span>
  )
}

export default function DayLink({
  dayNumber, label, className, disabledClassName, children,
}: {
  /** The day to open, or null for a dead end (no previous day). */
  dayNumber: number | null
  label: string
  className: string
  /** Used instead of className when there is no day to go to. */
  disabledClassName?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const href = dayNumber === null ? null : `?day=${dayNumber}`
  useEffect(() => {
    if (!href) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let gone = false
    const prefetch = () => router.prefetch(href, {
      // 'full', or a dynamic route is prefetched only down to its loading
      // boundary — a 1 KB skeleton, with the day itself still a server round
      // trip away on the click. Next does not export the PrefetchKind enum.
      kind: 'full' as Parameters<typeof router.prefetch>[1] extends { kind: infer K } | undefined ? K : never,
      // A router.refresh() — every punch — drops the entry (measured: the next
      // arrow click paid the full round trip). Fetch it again, two seconds
      // on, so the refresh that paints the punch has the connection to itself.
      onInvalidate: () => { if (!gone) timer = setTimeout(prefetch, 2000) },
    })
    prefetch()
    return () => { gone = true; clearTimeout(timer) }
  }, [router, href])
  if (href === null) {
    return <span aria-disabled className={cn(className, disabledClassName)}>{children}</span>
  }
  return (
    <Link prefetch={false} href={href} aria-label={label} className={className}>
      <Glyph>{children}</Glyph>
    </Link>
  )
}
