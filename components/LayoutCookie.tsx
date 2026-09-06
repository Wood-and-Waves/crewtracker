'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LAYOUT_COOKIE, LAYOUT_QUERY, type TrackerLayout } from '@/lib/trackerLayout'

/**
 * Tells the server which tracker tree this browser needs, so it renders ONE.
 *
 * The tracker has two layouts — the ruled desktop grid and MobileRoomTracker —
 * and until 2026-09-06 the server rendered BOTH on every request, hiding one
 * with CSS. `display:none` hides paint, not work: both trees were serialised,
 * sent, hydrated and reconciled on every punch's refresh, and 126 KB of a
 * 184 KB tracker response was markup for the two of them. The server cannot
 * measure a viewport, so the browser records which side of the `lg`
 * breakpoint it is on in a cookie and the page reads it (`?? both` when it
 * is missing, so a first visit still gets the CSS fallback and no flash).
 *
 * Renders nothing. Three jobs:
 *  - first visit: write the cookie so the NEXT render is single-tree;
 *  - a stale cookie (a window resized between visits): the server rendered
 *    the wrong tree and CSS is hiding it, so correct the cookie and refresh —
 *    the only case that costs a round trip, and it repairs itself;
 *  - crossing the breakpoint live (iPad rotation, a window drag): same.
 */
export default function LayoutCookie() {
  const router = useRouter()

  useEffect(() => {
    const mq = window.matchMedia(LAYOUT_QUERY)

    const current = (): TrackerLayout | null => {
      const m = document.cookie.match(new RegExp(`(?:^|; )${LAYOUT_COOKIE}=(desktop|mobile)`))
      return m ? (m[1] as TrackerLayout) : null
    }

    const sync = () => {
      const wanted: TrackerLayout = mq.matches ? 'desktop' : 'mobile'
      const had = current()
      if (had === wanted) return
      // A year, whole site, first-party only. Not HttpOnly on purpose — the
      // browser is the one that writes it.
      document.cookie = `${LAYOUT_COOKIE}=${wanted}; Path=/; Max-Age=31536000; SameSite=Lax`
      // No cookie meant the server rendered both trees, and CSS has already
      // picked the right one — nothing to repair. A WRONG cookie means the
      // tree on screen is the one CSS is hiding: fetch the right one.
      if (had !== null) router.refresh()
    }

    sync()
    // Both the media query's own event and plain window resize. sync() is a
    // no-op when nothing crossed the line, so the second listener costs
    // nothing — and one embedded browser was seen to resize its viewport
    // without ever firing the media query's `change`.
    mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [router])

  return null
}
