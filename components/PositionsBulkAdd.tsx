'use client'

import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import CallLinesEditor, { type CallLine } from '@/components/CallLinesEditor'
import { plannedAddCount, type GridLine } from '@/lib/crewCallGrid'
import { cn } from '@/lib/cn'

// Build a crew call once, then choose where it lands.
//
// The grid's only bulk action was copyDayTo, which works down a SINGLE room, so
// four rooms with a three-role call cost about forty interactions. Worse, there
// was no labelled way in at all — the one affordance was discovering that cells
// are clickable.
//
// The shape here is: queue the roles (the part CallLinesEditor already does
// well), tick which rooms, tick which days, press one button that says exactly
// what it is about to do. Everything defaults to ON, because "this call, in
// every room, every day" is the common case and the exceptions are quick to
// untick.
//
// Opens IN PLACE above the grid, never as a dialog: the design system rules out
// editors that cover what you are editing, and the grid below IS the preview —
// it updates the moment you commit, so nothing is hidden behind a modal.

// A selectable chip. Deliberately local rather than a components/ui primitive:
// this is its only caller, and building a primitive for one caller is how you
// end up with a design system nobody trusts. Promote it if a third screen wants
// one.
function PickChip({
  active, onClick, children, title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'rounded-pill border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-accent bg-accent-wash font-semibold text-accent'
          : 'border-line bg-surface-2 text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export default function PositionsBulkAdd({
  rooms,
  dates,
  roles,
  onApply,
  onClose,
}: {
  rooms: { key: string; name: string }[]
  dates: string[]
  roles: string[]
  /** Given the queued call and the chosen targets, apply it. */
  onApply: (roomKeys: string[], dayIndices: number[], lines: GridLine[]) => void
  onClose: () => void
}) {
  const [lines, setLines] = useState<CallLine[]>([])
  const [roomKeys, setRoomKeys] = useState<string[]>(() => rooms.map(r => r.key))
  const [dayIndices, setDayIndices] = useState<number[]>(() => dates.map((_, i) => i))

  const totalDays = dates.length

  // CallLine carries a `scope` field this panel does not use — days are picked
  // explicitly below, which is the same question asked once rather than twice.
  const gridLines: GridLine[] = useMemo(
    () => lines.map(l => ({ role: l.role, quantity: l.quantity })),
    [lines],
  )

  const count = plannedAddCount(roomKeys, dayIndices, gridLines, totalDays)
  const canApply = count > 0

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter(x => x !== value) : [...list, value]
  }

  const allRooms = roomKeys.length === rooms.length
  const allDays = dayIndices.length === totalDays

  return (
    <div className="mb-3 rounded-card border border-accent bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-ink">Add positions</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-ink"
        >
          Done
        </button>
      </div>

      {/* 1 — what the call is. */}
      <CallLinesEditor roles={roles} lines={lines} onChange={setLines} />

      {/* 2 — which rooms. */}
      <div className="mt-3 border-t border-line pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Rooms</span>
          <button
            type="button"
            onClick={() => setRoomKeys(allRooms ? [] : rooms.map(r => r.key))}
            className="text-[11px] text-accent hover:underline"
          >
            {allRooms ? 'None' : 'All rooms'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {rooms.map(r => (
            <PickChip
              key={r.key}
              active={roomKeys.includes(r.key)}
              onClick={() => setRoomKeys(prev => toggle(prev, r.key))}
            >
              {r.name.trim() || 'Unnamed room'}
            </PickChip>
          ))}
        </div>
      </div>

      {/* 3 — which days. */}
      <div className="mt-3 border-t border-line pt-2.5">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Days</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDayIndices(allDays ? [] : dates.map((_, i) => i))}
              className="text-[11px] text-accent hover:underline"
            >
              {allDays ? 'None' : 'All days'}
            </button>
            {totalDays > 1 && (
              <button
                type="button"
                // Set, not array: on a one-day run first and last are the same
                // day, and picking it twice would double the count shown.
                onClick={() => setDayIndices([...new Set([0, totalDays - 1])])}
                className="text-[11px] text-accent hover:underline"
              >
                First + last
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {dates.map((date, i) => {
            const d = new Date(date + 'T00:00:00')
            return (
              <PickChip
                key={date}
                active={dayIndices.includes(i)}
                onClick={() => setDayIndices(prev => toggle(prev, i))}
                title={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              >
                {d.toLocaleDateString('en-US', { weekday: 'short' })} {d.getDate()}
              </PickChip>
            )
          })}
        </div>
      </div>

      {/* 4 — commit, saying what it will do. Borrowed from CrewCallModal, whose
          button counts its work for the same reason: a bulk action that could
          write sixty rows should never be a bare "Add". */}
      <Button
        type="button"
        size="sm"
        className="mt-3 w-full"
        disabled={!canApply}
        onClick={() => { onApply(roomKeys, dayIndices, gridLines); setLines([]) }}
      >
        {count === 0
          ? 'Add positions'
          : `Add ${count} position${count === 1 ? '' : 's'}` +
            ` across ${roomKeys.length} room${roomKeys.length === 1 ? '' : 's'}` +
            ` and ${dayIndices.length} day${dayIndices.length === 1 ? '' : 's'}`}
      </Button>
    </div>
  )
}
