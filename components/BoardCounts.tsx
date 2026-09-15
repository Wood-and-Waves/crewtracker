'use client'

// The strip's one line of counts. A client component purely so it can see what
// the grid has already been told — see components/BoardPaint.tsx.

import { useEffect } from 'react'
import { describeBoard, type Board } from '@/lib/scheduleBoard'
import { useBoardPaint, usePaintedBoard } from '@/components/BoardPaint'

export default function BoardCounts({ board }: { board: Board }) {
  const paintedBoard = usePaintedBoard(board)
  const ctx = useBoardPaint()
  // The strip is the one thing rendered on every refresh whatever the grid is
  // doing, so it is where the reconcile belongs: when the server's board
  // finally carries a booking, the local copy of it is dropped.
  useEffect(() => { ctx?.reconcile(board) }, [board])
  return <p className="text-sm font-semibold text-ink">{describeBoard(paintedBoard.summary)}</p>
}
