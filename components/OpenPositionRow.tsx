'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'
import FillPositionPicker from '@/components/FillPositionPicker'

// An unfilled position, shown as a row in the tracker.
//
// Dan: "It shows the open position and asks for a fill. I would like this in
// tracker. It is cleaner than having to press the 3 dots." He is right — a gap
// in the crew is something you should SEE while looking at the room, not
// something you go hunting for behind a menu. The tracker's whole job is
// showing the state of a room, and "we are one stagehand short" is part of that
// state.
//
// The picker opens inline beneath the row rather than in a dialog, matching the
// grid on New Show: an editor that covers the thing you are editing is the
// pattern this redesign has been removing.

export default function OpenPositionRow({
  positionId,
  role,
  roomId,
  date,
  gridCols,
  punchCount,
  locked = false,
}: {
  positionId: string
  role: string
  roomId: string
  date: string
  gridCols: string
  punchCount: number
  locked?: boolean
}) {
  const router = useRouter()
  const [filling, setFilling] = useState(false)

  return (
    <div className="border-b border-line last:border-b-0">
      <div className={cn('grid grid-cols-3 gap-2 p-4 lg:items-center lg:gap-3 lg:py-3', gridCols)}>
        <div className="col-span-3 lg:col-span-1">
          <p className="text-sm font-semibold text-muted">Open position</p>
          <p className="text-xs text-staffing">{role} · not filled</p>
        </div>

        {/* Spans the punch columns: there are no times to show until somebody
            is in the role. Literal class names so Tailwind generates them. */}
        <div className={cn(
          'col-span-3 flex justify-center',
          punchCount === 7 ? 'lg:col-span-7' : punchCount === 8 ? 'lg:col-span-8' : 'lg:col-span-6',
        )}>
          <button
            onClick={() => setFilling(v => !v)}
            disabled={locked}
            title={locked ? 'Times are locked — the final report has been sent.' : undefined}
            className="rounded-pill border border-accent px-4 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent-wash disabled:opacity-40"
          >
            {filling ? 'Cancel' : 'Fill'}
          </button>
        </div>

        <div className="hidden lg:block" />
        <div className="hidden lg:block" />
        <div className="hidden lg:block" />
      </div>

      {filling && !locked && (
        <div className="px-4 pb-4">
          <FillPositionPicker
            positionId={positionId}
            positionRole={role}
            roomId={roomId}
            date={date}
            onCancel={() => setFilling(false)}
            onFilled={() => {
              setFilling(false)
              // Without this the insert succeeds and the row still says "Open
              // position", which is indistinguishable from the booking having
              // failed — exactly how it looked to Dan.
              router.refresh()
            }}
          />
        </div>
      )}
    </div>
  )
}
