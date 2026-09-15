'use client'

import { useEffect, useState, type RefObject } from 'react'

// WHICH WAY A MENU SHOULD OPEN, on both axes.
//
// Down and left-aligned by default; UP when there is no room below (Dan,
// 2026-09-08: "The dropdown menu should go up when at the bottom") and
// RIGHT-ALIGNED when there is no room to the right — which is a grid of days
// running off the side of its own scroll box, so the menu on the LAST column
// was drawn half outside it and its items could not be read or reached (Dan,
// 2026-09-15).
//
// The room available is decided by the nearest CLIPPING ancestor on each axis,
// not by the window — an absolutely positioned panel inside an overflow box is
// clipped by that box. The Scheduling grid is exactly this: it is its own
// scroll box on purpose, so its day header can stick, which means a menu inside
// it is bounded on all four sides by something that is not the screen.
// `components/ui/Select` learned the vertical half on its own (2026-09-07, a
// picker that fell off the bottom of the page) and keeps its own copy.

export type MenuPlacement = {
  /** 'up' means the panel's BOTTOM sits on the trigger's top. */
  vertical: 'down' | 'up'
  /** 'right' means the panel's RIGHT edge sits on the trigger's right. */
  horizontal: 'left' | 'right'
}

const CLIPS = new Set(['auto', 'scroll', 'hidden'])

export function useMenuPlacement(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  /** Roughly how tall the panel is; a menu of four items is about 180px. */
  needed = 200,
  /** Roughly how wide it is. Chip menus are ~180px, the confirm slips ~260. */
  width = 200,
): MenuPlacement {
  const [placement, setPlacement] = useState<MenuPlacement>({ vertical: 'down', horizontal: 'left' })

  useEffect(() => {
    if (!open || !ref.current) { setPlacement({ vertical: 'down', horizontal: 'left' }); return }
    const r = ref.current.getBoundingClientRect()
    let bottom = window.innerHeight
    let top = 0
    let right = window.innerWidth
    let left = 0
    // The two axes can be clipped by DIFFERENT ancestors, so each is searched
    // until it finds its own — stopping at the first box that clips either one
    // would leave the other measured against the window and put the panel back
    // outside the box it actually lives in.
    let foundY = false
    let foundX = false
    for (let el = ref.current.parentElement; el && (!foundY || !foundX); el = el.parentElement) {
      const cs = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      if (!foundY && CLIPS.has(cs.overflowY)) {
        bottom = Math.min(bottom, box.bottom)
        top = Math.max(top, box.top)
        foundY = true
      }
      if (!foundX && CLIPS.has(cs.overflowX)) {
        right = Math.min(right, box.right)
        left = Math.max(left, box.left)
        foundX = true
      }
    }

    const below = bottom - r.bottom
    const above = r.top - top
    // Left-aligned means the panel runs rightward FROM the trigger's left edge,
    // so the room it needs is measured from there — not from its right edge.
    const toRight = right - r.left
    const toLeft = r.right - left

    setPlacement({
      vertical: below < needed && above > below ? 'up' : 'down',
      horizontal: toRight < width && toLeft > toRight ? 'right' : 'left',
    })
  }, [open, ref, needed, width])

  return placement
}
