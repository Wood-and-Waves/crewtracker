'use client'

import { useEffect, useState } from 'react'

// A refreshed page painted ONE WRITE BEHIND until the next click (2026-10-13;
// Dan, TxDOT: a wrap saved at 7:00 PM kept 0.00 ST beside it, and "if I click
// travel in, the hours populate"). Every router.refresh() in the app — 83 of
// them — had been doing this since the per-screen skeletons landed on
// 2026-10-04, and that is the lead: bisected on a local production build, the
// refresh commits on its own with no loading.tsx above the page and stalls
// with one, at any level.
//
// The mechanism is Next's, not ours. With a loading boundary a segment can be
// prefetched partially, so its cache node carries a `prefetchRsc`, and
// layout-router.js then renders every change of the segment — a refresh
// included — through `useDeferredValue(cacheNode.rsc, prefetchRsc)`: the OLD
// content first, then a deferred re-render with the new. That deferred render
// was never flushed on its own; any state update anywhere re-kicks React's
// scheduler and it paints at once, which is all the next click was doing.
//
// This component is that update. Whenever a server-component response
// (`_rsc=` in the URL — a refresh, a navigation, a prefetch) finishes, it ticks
// its own state a few times over the next second and a half. It renders
// nothing, so a tick costs nothing; the cost of not having it is every
// refresh in the app showing yesterday's numbers.
//
// To retire it: after a Next upgrade, remove it from app/layout.tsx, build,
// and move a wrap through the tracker's time dialog — the row's hours must
// change with no further click. If they do, delete this file.

const NUDGES_MS = [50, 400, 1500]

export default function RefreshNudge() {
  const [, tick] = useState(0)
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const observer = new PerformanceObserver(list => {
      if (!list.getEntries().some(e => e.name.includes('_rsc='))) return
      for (const ms of NUDGES_MS) {
        const t = setTimeout(() => { timers.delete(t); tick(n => n + 1) }, ms)
        timers.add(t)
      }
    })
    observer.observe({ type: 'resource', buffered: false })
    return () => { observer.disconnect(); timers.forEach(clearTimeout) }
  }, [])
  return null
}
