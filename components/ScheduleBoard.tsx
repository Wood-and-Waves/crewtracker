'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'
import BookingStatusChip from '@/components/BookingStatusChip'
import FillPositionPicker from '@/components/FillPositionPicker'
import SlotFlagActions from '@/components/SlotFlagActions'
import CrewChangeNotice from '@/components/CrewChangeNotice'
import { dayLabel, dayActivitiesBgClass } from '@/lib/dayActivities'
import { cellKey, type Board, type BoardEntry } from '@/lib/scheduleBoard'

// Rooms down the side, days across the top, every cell that room-day's
// positions — the same shape as New Show's grid, which is how the show was
// built in the first place.
//
// Tap OPEN and the Fill picker opens in a full-width row under that room,
// never in a dialog over the cell: an editor that covers what you are editing
// is the pattern this redesign removed. Tap a CHIP and the answer menu opens in
// place. A flagged booking says so and opens Move / Keep / Release in the cell.
//
// The column template is an inline style on purpose: the day count varies at
// runtime and Tailwind only generates classes it can SEE in the source (the
// same trap punchGridCols avoids with literal class names).

function dayHead(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function ScheduleBoard({
  showId, board, locked = false,
}: {
  showId: string
  board: Board
  locked?: boolean
}) {
  const router = useRouter()
  const [picker, setPicker] = useState<{ slotId: string; roomId: string; role: string; date: string; roomName: string } | null>(null)
  const [openFlag, setOpenFlag] = useState<string | null>(null)
  const [changed, setChanged] = useState<{ id: string; name: string }[]>([])

  const cols = { gridTemplateColumns: `minmax(132px, 170px) repeat(${board.days.length}, minmax(148px, 1fr))` }

  function entryNode(e: BoardEntry, roomName: string, date: string) {
    if (e.kind === 'open') {
      return (
        <button
          key={e.slotId}
          type="button"
          disabled={locked}
          onClick={() => setPicker(p => p?.slotId === e.slotId
            ? null
            : { slotId: e.slotId, roomId: e.roomId, role: e.role, date, roomName })}
          title={locked ? 'Times are locked — the final report has been sent.' : `Fill ${e.role}`}
          className={cn(
            'block w-full truncate rounded-field border border-dashed border-accent px-2 py-1 text-left text-xs font-semibold text-accent hover:bg-accent-wash disabled:opacity-40',
            picker?.slotId === e.slotId && 'bg-accent-wash',
          )}
        >
          Open · {e.role}
        </button>
      )
    }
    const b = e.booking
    const flag = e.flag
    return (
      <div key={b.timecardId} className="min-w-0">
        <div className="truncate text-sm text-ink">{b.crewMemberName}</div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="truncate text-[11px] text-muted">{b.role || 'Crew'}</span>
          <BookingStatusChip
            context="scheduling"
            showId={showId}
            crewMemberId={b.crewMemberId}
            crewName={b.crewMemberName}
            status={b.status}
            locked={locked}
          />
        </div>
        {flag && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setOpenFlag(f => f === flag.slot_id ? null : flag.slot_id)}
              className="text-[11px] font-semibold text-ot hover:underline"
            >
              Day no longer fits ▾
            </button>
            {openFlag === flag.slot_id && (
              <div className="mt-1">
                <SlotFlagActions
                  showId={showId}
                  flag={flag}
                  locked={locked}
                  onChanged={p => setChanged(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p])}
                  onDone={() => setOpenFlag(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Day header — a LIGHT strip, because the show masthead above is the
              screen's one solid band. Each day carries its activities label:
              that is what explains which cells exist at all. */}
          <div style={cols} className="grid border-b-2 border-ink bg-surface-2">
            <div className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Room</div>
            {board.days.map(d => (
              <div key={d.date} className="min-w-0 px-3 py-2">
                <div className="truncate text-[11px] font-bold uppercase tracking-wide text-ink">{dayHead(d.date)}</div>
                {dayLabel(d.activities) && (
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase text-muted">
                    <span className={cn('h-2 w-2 shrink-0', dayActivitiesBgClass(d.activities) ?? 'bg-line')} />
                    <span className="truncate">{dayLabel(d.activities)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {board.roomNames.map(roomName => (
            <div key={roomName} className="border-b border-line last:border-b-0">
              <div style={cols} className="grid">
                <div className="bg-surface-2 px-3 py-3 font-display text-[12px] font-semibold uppercase tracking-[0.08em] text-ink">
                  {roomName}
                </div>
                {board.days.map(d => {
                  const cell = board.cells[cellKey(roomName, d.date)]
                  return (
                    <div key={d.date} className="flex min-w-0 flex-col gap-2 border-l border-line px-3 py-3">
                      {!cell?.roomId ? (
                        <span className="text-xs text-muted">—</span>
                      ) : cell.entries.length === 0 ? (
                        <span className="text-xs text-muted">No positions</span>
                      ) : (
                        cell.entries.map(e => entryNode(e, roomName, d.date))
                      )}
                    </div>
                  )
                })}
              </div>

              {/* The picker for THIS room, full width under its row. */}
              {picker?.roomName === roomName && (
                <div className="border-t border-line px-3 py-3">
                  <p className="mb-2 text-xs text-muted">{roomName} · {dayHead(picker.date)}</p>
                  <FillPositionPicker
                    positionId={picker.slotId}
                    positionRole={picker.role}
                    roomId={picker.roomId}
                    date={picker.date}
                    onCancel={() => setPicker(null)}
                    onFilled={() => { setPicker(null); router.refresh() }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {changed.length > 0 && (
        <div className="mt-4">
          <CrewChangeNotice showId={showId} people={changed} onDone={() => setChanged([])} />
        </div>
      )}
    </div>
  )
}
