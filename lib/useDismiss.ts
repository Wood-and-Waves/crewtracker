'use client'

import { useEffect, useRef, type RefObject } from 'react'

// Click outside, or press Escape, and the thing closes (Dan, 2026-09-08: "It
// is normal to click outside a dialogue box and have it go away. This one
// forces me to click cancel").
//
// The pattern was already written twice by hand — components/ui/Select and
// ui/AccountMenu each carry their own copy — so this is where the third and
// every later one live. Those two are left alone on purpose: they work, and
// their effects are entangled with keyboard navigation.
//
// `mousedown`, not `click`: a menu that closes on mouse-UP swallows the press
// that opened something else, and the person has to click twice. The callback
// is held in a ref so a fresh closure on every render does not re-subscribe.
//
// Hook module, imported only by client components.

export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  const cb = useRef(onDismiss)
  cb.current = onDismiss

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cb.current()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, ref])
}
