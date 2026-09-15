'use client'

// WHAT HAS BEEN BOOKED BUT NOT YET RE-RENDERED, shared by the grid and the
// strip above it.
//
// A fill is a verified write, but the name used to appear only once a full
// server re-render of the whole screen came back — "a pretty long beat before
// it is populated" (Dan, 2026-09-15). ScheduleBoard now paints it at write
// acknowledgement, the way the tracker has painted punches since September.
//
// This state is a CONTEXT rather than ScheduleBoard's own because the counts
// are not on the board: the page renders "12 of 20 positions confirmed · 3
// open" in the strip above it. Held locally, the grid would fill in while the
// strip still said those cells were open — the exact disagreement the counting
// rules exist to prevent ("counted FROM THE GRID, so the strip can never
// disagree with what is on it"). One state, both readers, no drift.

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { applyPending, type Board, type PendingChange } from '@/lib/scheduleBoard'

type Ctx = {
  pending: PendingChange[]
  /** Hand over writes the database has already accepted. */
  paint: (changes: PendingChange[]) => void
  /** Drop anything the given server board has caught up on. */
  reconcile: (serverBoard: Board) => void
}

const BoardPaintContext = createContext<Ctx | null>(null)

export function BoardPaintProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingChange[]>([])

  const paint = useCallback((changes: PendingChange[]) => {
    setPending(prev => [...prev, ...changes])
  }, [])

  const reconcile = useCallback((serverBoard: Board) => {
    setPending(prev => {
      if (prev.length === 0) return prev
      // Dropped only when the SERVER's own board has caught up on that exact
      // change — never on "a refresh happened". Clearing blindly would flash a
      // cell back if the refresh that landed was somebody else's.
      const stillOpen = new Set<string>()
      const stillThere = new Set<string>()
      for (const room of serverBoard.rooms)
        for (const line of room.lines)
          for (const e of Object.values(line.byDate)) {
            if (!e) continue
            if (e.kind === 'open') stillOpen.add(e.slotId)
            else if (e.booking.crewMemberId) stillThere.add(e.booking.crewMemberId)
          }
      const kept = prev.filter(p =>
        p.kind === 'book' ? stillOpen.has(p.slotId) : stillThere.has(p.crewMemberId))
      return kept.length === prev.length ? prev : kept
    })
  }, [])

  const value = useMemo(() => ({ pending, paint, reconcile }), [pending, paint, reconcile])
  return <BoardPaintContext.Provider value={value}>{children}</BoardPaintContext.Provider>
}

/** The board as it should look right now: the server's, plus what we just wrote. */
export function usePaintedBoard(serverBoard: Board) {
  const ctx = useContext(BoardPaintContext)
  const pending = ctx?.pending ?? EMPTY
  return useMemo(() => applyPending(serverBoard, pending), [serverBoard, pending])
}

export function useBoardPaint() {
  return useContext(BoardPaintContext)
}

const EMPTY: PendingChange[] = []
