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
import { applyBookings, type Board, type PaintedBooking } from '@/lib/scheduleBoard'

type Ctx = {
  painted: PaintedBooking[]
  /** Hand over rows the database has already accepted. */
  paint: (rows: PaintedBooking[]) => void
  /** Drop anything the given server board has caught up on. */
  reconcile: (serverBoard: Board) => void
}

const BoardPaintContext = createContext<Ctx | null>(null)

export function BoardPaintProvider({ children }: { children: React.ReactNode }) {
  const [painted, setPainted] = useState<PaintedBooking[]>([])

  const paint = useCallback((rows: PaintedBooking[]) => {
    setPainted(prev => [...prev, ...rows])
  }, [])

  const reconcile = useCallback((serverBoard: Board) => {
    setPainted(prev => {
      if (prev.length === 0) return prev
      // Dropped only when the SERVER's own board no longer shows that slot as
      // open — not on any refresh. Clearing blindly would flash a cell back to
      // Open if the refresh that landed happened to be somebody else's.
      const stillOpen = new Set<string>()
      for (const room of serverBoard.rooms)
        for (const line of room.lines)
          for (const e of Object.values(line.byDate))
            if (e && e.kind === 'open') stillOpen.add(e.slotId)
      const kept = prev.filter(p => stillOpen.has(p.slotId))
      return kept.length === prev.length ? prev : kept
    })
  }, [])

  const value = useMemo(() => ({ painted, paint, reconcile }), [painted, paint, reconcile])
  return <BoardPaintContext.Provider value={value}>{children}</BoardPaintContext.Provider>
}

/** The board as it should look right now: the server's, plus what we just wrote. */
export function usePaintedBoard(serverBoard: Board) {
  const ctx = useContext(BoardPaintContext)
  const painted = ctx?.painted ?? EMPTY
  return useMemo(() => applyBookings(serverBoard, painted), [serverBoard, painted])
}

export function useBoardPaint() {
  return useContext(BoardPaintContext)
}

const EMPTY: PaintedBooking[] = []
