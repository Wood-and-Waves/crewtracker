'use client'

import { useEffect, useState, type RefObject } from 'react'

// Which way a menu should open: down by default, UP when there is no room
// below (Dan, 2026-09-08: "The dropdown menu should go up when at the bottom").
//
// The room available is decided by the nearest SCROLLING ancestor, not by the
// window — an absolutely positioned panel inside an overflow box is clipped by
// that box, which is exactly what happened on the last row of the Scheduling
// grid. `components/ui/Select` learned the same lesson on its own (2026-09-07,
// a picker that fell off the bottom of the page) and keeps its own copy.

export function useDropDirection(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  /** Roughly how tall the panel is; a menu of four items is about 180px. */
  needed = 200,
): 'down' | 'up' {
  const [dir, setDir] = useState<'down' | 'up'>('down')

  useEffect(() => {
    if (!open || !ref.current) { setDir('down'); return }
    const r = ref.current.getBoundingClientRect()
    let bottom = window.innerHeight
    let top = 0
    for (let el = ref.current.parentElement; el; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
        const er = el.getBoundingClientRect()
        bottom = Math.min(bottom, er.bottom)
        top = Math.max(top, er.top)
        break
      }
    }
    const below = bottom - r.bottom
    const above = r.top - top
    setDir(below < needed && above > below ? 'up' : 'down')
  }, [open, ref, needed])

  return dir
}
