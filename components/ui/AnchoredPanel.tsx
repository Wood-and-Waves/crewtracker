'use client'

// A PANEL THAT CANNOT BE CLIPPED BY WHAT IT OPENS FROM.
//
// The Scheduling grid is its own scroll box on purpose — that is what lets the
// day header stick — so an absolutely positioned menu inside it is bounded on
// all four sides by something that is not the screen. Flipping it up, then
// right, then guessing its height, each fixed one edge and left another (Dan,
// 2026-09-15, on the third of these: "Its better, but the menu is still falling
// off. Is it possible to show it all?"). It is, but not from inside the box:
// the panel has to leave it.
//
// So this renders into document.body and positions itself `fixed` against the
// anchor's rect, MEASURED rather than estimated: below if it fits, above if it
// does not, and clamped to the viewport either way, so the last resort is a
// panel that has moved rather than one with its bottom cut off.
//
// This is NOT the fixed-position editor the design rules forbid. That rule is
// about a dialog COVERING the thing being edited; this stays visually pinned to
// its chip and covers nothing but the grid behind it.
//
// It owns its own dismissal, because it has to: useDismiss closes on a click
// outside ONE ref, and a portalled panel is not inside the chip's wrapper, so
// every click on a menu item would read as "outside" and close it before it
// fired.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

/** Breathing room kept between the panel and the edge of the window. */
const MARGIN = 8
/** The gap between the anchor and the panel. */
const GAP = 4

export default function AnchoredPanel({
  anchorRef, open, onDismiss, className, children, role,
}: {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onDismiss: () => void
  className?: string
  children: React.ReactNode
  role?: 'menu' | 'dialog'
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Before paint, so the panel never appears in the wrong place first.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const p = panelRef.current?.getBoundingClientRect()
      if (!a || !p) return
      const vw = window.innerWidth
      const vh = window.innerHeight

      // Left-aligned with the anchor; right-aligned when that would overflow;
      // clamped when even that does not fit (a panel wider than the window).
      let left = a.left
      if (left + p.width > vw - MARGIN) left = a.right - p.width
      left = Math.max(MARGIN, Math.min(left, vw - p.width - MARGIN))

      // Below, else above, else pinned to whichever edge leaves it whole.
      let top = a.bottom + GAP
      if (top + p.height > vh - MARGIN) {
        const above = a.top - GAP - p.height
        top = above >= MARGIN ? above : Math.max(MARGIN, vh - p.height - MARGIN)
      }
      setPos({ top, left })
    }
    place()

    // The grid scrolls under it, so follow rather than float: `true` catches
    // scrolls on ancestors, which is where the movement actually happens.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, children])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      // The ANCHOR counts as inside: its own click handler toggles the panel,
      // and closing here first would make the second press re-open it.
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onDismissRef.current()
    }
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onDismissRef.current() }
    // mousedown, not click — the same reason lib/useDismiss gives: closing on
    // mouse-UP swallows the press that opens something else.
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, anchorRef])

  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  if (!open || !mounted) return null

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        // Taller than the window is the one case position cannot solve, so it
        // scrolls inside itself rather than running off the bottom.
        maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
      }}
      className={cn('z-50 overflow-y-auto paper-scroll', className)}
    >
      {children}
    </div>,
    document.body,
  )
}
