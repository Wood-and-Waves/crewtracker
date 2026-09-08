'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'
import BookingStatusChip from '@/components/BookingStatusChip'
import FillPositionPicker from '@/components/FillPositionPicker'
import SlotFlagActions from '@/components/SlotFlagActions'
import CrewChangeNotice from '@/components/CrewChangeNotice'
import { dayLabel, dayActivitiesBgClass } from '@/lib/dayActivities'
import type { Board, BoardEntry, BoardRoom } from '@/lib/scheduleBoard'

// Rooms down the side, days across the top — and it reads like a grid, because
// it is one (Dan, 2026-09-08: "Make this more gridline with lines and line
// everything up down the row"). Every ROW is one position and runs the width of
// the show: the same person all week, or the open slot, or nothing on a day
// they are not on. Nothing shifts because a stagehand joins on Tuesday.
//
// Tap OPEN and the Fill picker opens in a full-width row under that room, never
// in a dialog over the cell: an editor that covers what you are editing is the
// pattern this redesign removed. Tap a CHIP and the answer menu opens in place.
// A flagged booking says so and opens Move / Keep / Release right there.
//
// The column template is an inline style on purpose: the day count varies at
// runtime and Tailwind only generates classes it can SEE in the source (the
// same trap punchGridCols avoids with literal class names).
//
// THE GRID IS ITS OWN SCROLL BOX so the day header can stay put (Dan,
// 2026-09-08: "Can the position date header be sticky to the top? When I
// scroll down, it goes away"). It has to be: a horizontal scroller is a
// vertical one too — CSS turns the other axis to `auto` whatever you ask for —
// so a header sticking to the PAGE would leave with the box. Inside its own
// box, `sticky top-0` pins to the box and the days stay overhead all the way
// down. The position column pins the same way to the left, so a name still
// says what it is seven days across.

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

  const cols = { gridTemplateColumns: `minmax(140px, 190px) repeat(${board.days.length}, minmax(150px, 1fr))` }
  // The grid is wider than the box on anything but a big screen, and the rows
  // inside are block-level: without a width of their own they stop at the box's
  // edge, so a sticky header's BACKGROUND stopped there too and the rows
  // underneath showed through the right-hand days once you scrolled sideways.
  // Give the whole stack the grid's own width — the same minima as the template.
  const gridWidth = { minWidth: `${190 + board.days.length * 150}px` }

  function cellNode(e: BoardEntry | null, roomName: string, date: string, runs: boolean) {
    // A day this room does not run at all reads as nothing, not as a gap to
    // fill: the room is not there to staff.
    if (!e) return <span className="text-xs text-muted">{runs ? '·' : ''}</span>

    if (e.kind === 'open') {
      const active = picker?.slotId === e.slotId
      return (
        <button
          type="button"
          disabled={locked}
          onClick={() => setPicker(p => p?.slotId === e.slotId
            ? null
            : { slotId: e.slotId, roomId: e.roomId, role: e.role, date, roomName })}
          title={locked ? 'Times are locked — the final report has been sent.' : `Fill ${e.role}`}
          className={cn(
            'w-full truncate rounded-field border border-dashed border-accent px-2 py-1 text-left text-xs font-semibold text-accent hover:bg-accent-wash disabled:opacity-40',
            active && 'bg-accent-wash',
          )}
        >
          {active ? 'Filling…' : 'Open'}
        </button>
      )
    }

    const b = e.booking
    const flag = e.flag
    return (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="truncate text-sm text-ink">{b.crewMemberName}</span>
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
          <div className="mt-0.5">
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

  function roomBlock(room: BoardRoom) {
    return (
      <div key={room.name}>
        {/* The room's own strip, spanning the grid: a light rule-closed band,
            never a second solid slab (the masthead above is the one band). */}
        <div className="border-y border-ink/20 bg-surface-2 py-1.5">
          {/* The strip runs the width of the grid, so the NAME is what rides
              along when you scroll sideways — sticky on the strip itself would
              do nothing, since it is already as wide as the scroll. */}
          <span className="sticky left-0 z-20 inline-block px-3 font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-ink">
            {room.name}
          </span>
        </div>

        {room.lines.length === 0 ? (
          <div className="border-b border-line px-3 py-3 text-xs text-muted">No positions in this room yet.</div>
        ) : room.lines.map(line => (
          <div key={line.key}>
            <div style={cols} className="grid border-b border-line">
              <div className="sticky left-0 z-10 flex items-center bg-bg px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <span className="truncate">{line.role || 'Crew'}</span>
              </div>
              {board.days.map(d => (
                <div key={d.date} className="flex min-w-0 items-center border-l border-line px-3 py-2">
                  {cellNode(line.byDate[d.date], room.name, d.date, !!room.roomIdByDate[d.date])}
                </div>
              ))}
            </div>

            {/* The picker, full width under the line it belongs to. */}
            {picker && picker.roomName === room.name && line.byDate[picker.date]?.kind === 'open'
              && (line.byDate[picker.date] as Extract<BoardEntry, { kind: 'open' }>).slotId === picker.slotId && (
              <div className="border-b border-line bg-surface-2/40 px-3 py-3">
                <p className="mb-2 text-xs text-muted">{room.name} · {line.role} · {dayHead(picker.date)}</p>
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
    )
  }

  return (
    <div className="mt-4">
      {/* Tall enough to be worth pinning a header to, short enough that the
          definitions editor below is still reachable by scrolling the page.
          The bottom tab bar owns the last 6rem below lg, so the box is shorter
          there. */}
      <div className="max-h-[calc(100vh-19rem)] overflow-auto lg:max-h-[calc(100vh-16rem)]">
        <div style={gridWidth}>
          {/* Day header — a LIGHT strip, because the show masthead above is the
              screen's one solid band. Each day carries its activities label:
              that is what explains which cells exist at all. */}
          <div style={cols} className="sticky top-0 z-30 grid border-b-2 border-ink bg-surface-2">
            <div className="sticky left-0 z-10 bg-surface-2 px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Position</div>
            {board.days.map(d => (
              <div key={d.date} className="min-w-0 border-l border-line px-3 py-2">
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

          {board.rooms.map(roomBlock)}
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
