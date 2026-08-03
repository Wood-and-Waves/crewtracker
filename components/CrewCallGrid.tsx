'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import { dayTypeLabel } from '@/lib/dayTypes'
import { cn } from '@/lib/cn'
import {
  addRole, removeRole, clearDay, copyDayTo, cellLines, cellCount, peakPerDay,
  type CallModel,
} from '@/lib/crewCallGrid'

// The crew call, as rooms down and days across.
//
// THE GRID IS THE EDITOR. Clicking a cell opens the panel BELOW the grid, never
// a popup — a dialog inside a dialog is what this whole screen is escaping, and
// an editor that covers the thing you are editing is worse than useless when
// the point is comparing days.
//
// Bulk work is done by copying rather than by a scope dropdown: build the first
// day, then "copy to every day". That reads as what you are actually doing and
// it can express shapes a dropdown cannot, like one day being different.
//
// THE GRID IS THE SCREEN AT EVERY WIDTH. The first version dropped to a
// per-room list with a "which days" dropdown below 1024px, on the theory that a
// grid needs too much width. Dan, on a phone: "I don't see the new create show
// screen on mobile. It still has the drop downs." He is right — the grid IS the
// feature, and a fallback that reinstates the dropdowns is the old screen
// wearing a new name. Narrow columns and a horizontal scroll inside the grid's
// own container beat a different interaction model.

export type GridRoom = { key: string; name: string }

// Wide enough for a two-digit count, a weekday, a day-type label and now the
// role names inside a cell.
//
// This was 58, chosen so four days plus the room name fit a 375px phone with
// only a nudge of horizontal scroll. That constraint was set before the room
// column became sticky; now that the room name never scrolls away, a little
// more horizontal scroll costs far less than a cell you cannot read.
const NAME_COL = 132
const MIN_DAY_COL = 68

function dayLabel(date: string) {
  // Bare 'YYYY-MM-DD' + T00:00:00 = local midnight; a date-only string parses as
  // UTC and renders as the previous day west of Greenwich.
  const d = new Date(date + 'T00:00:00')
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: d.getDate(),
    isWeekend: d.getDay() === 0 || d.getDay() === 6,
  }
}

export default function CrewCallGrid({
  rooms,
  dates,
  call,
  roles,
  onChange,
  onRoomsChange,
  dayTypes,
  invalidRoomKeys,
  readOnly = false,
}: {
  rooms: GridRoom[]
  dates: string[]
  call: CallModel
  roles: string[]
  onChange: (next: CallModel) => void
  onRoomsChange: (next: GridRoom[]) => void
  /** Day type per DATE, for the column headers. Optional — unset days show none. */
  dayTypes?: Record<string, string>
  /** Rooms whose name would cost them their positions at create time. */
  invalidRoomKeys?: string[]
  readOnly?: boolean
}) {
  const [selected, setSelected] = useState<{ roomKey: string; day: number } | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)

  // Bring the editor into view when a cell is picked. 'nearest' rather than
  // 'center': on a desktop where it is already visible, centring would jolt the
  // page for no reason.
  useEffect(() => {
    if (selected) editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState(1)

  const totalDays = dates.length
  const gridTemplateColumns = `${NAME_COL}px repeat(${totalDays}, minmax(${MIN_DAY_COL}px, 1fr))`
  const minWidth = NAME_COL + totalDays * MIN_DAY_COL
  const perDay = peakPerDay(call, totalDays)

  function addRoom() {
    onRoomsChange([...rooms, { key: crypto.randomUUID(), name: '' }])
  }

  function removeRoom(key: string) {
    onRoomsChange(rooms.filter(r => r.key !== key))
    const next = { ...call }
    delete next[key]
    onChange(next)
    if (selected?.roomKey === key) setSelected(null)
  }

  function addToSelected() {
    if (!selected || !role) return
    onChange(addRole(call, selected.roomKey, selected.day, role, quantity))
    setRole('')
    setQuantity(1)
  }

  const sel = selected ? cellLines(call, selected.roomKey, selected.day) : []
  const selRoom = selected ? rooms.find(r => r.key === selected.roomKey) : null

  const roleSelect = (onAdd: () => void) => (
    <div className="flex gap-2">
      {/* key tied to the options: iPad Safari has a hydration bug that
          duplicates <option> inside a controlled <select>. */}
      <select
        key={roles.join(',')}
        value={role}
        onChange={e => setRole(e.target.value)}
        className="min-w-0 flex-1 rounded-field border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
      >
        <option value="" className="bg-surface-2 text-ink">Add a role…</option>
        {roles.map(r => (
          <option key={r} value={r} className="bg-surface-2 text-ink">{r}</option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={20}
        value={quantity}
        onChange={e => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
        aria-label="How many"
        className="w-14 rounded-field border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
      />
      <Button type="button" size="sm" variant="ghost" onClick={onAdd} disabled={!role}>Add</Button>
    </div>
  )

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-muted">Rooms &amp; positions</span>
        <span className="text-xs text-muted">
          {perDay > 0 ? `${perDay} crew on the busiest day` : 'No positions yet'}
        </span>
      </div>

      {/* Desktop grid */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <div style={{ minWidth }}>
          <div className="grid border-b border-line bg-surface-2" style={{ gridTemplateColumns }}>
            {/* Sticky room column, copied from ScheduleGrid which sits on
                identical scaffolding. Without it, scrolling right on a long run
                loses which room you are looking at — the single worst thing
                about this grid on a phone. The opaque background is NOT
                optional: without it the day cells scroll visibly underneath. */}
            <div className="sticky left-0 z-20 border-r border-line bg-surface-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Room
            </div>
            {dates.map((date, i) => {
              const l = dayLabel(date)
              return (
                <div
                  key={date}
                  className={cn(
                    'border-l border-line px-1 py-1.5 text-center',
                    l.isWeekend && 'bg-bg',
                  )}
                >
                  <div className="text-[9px] uppercase text-muted">{l.weekday}</div>
                  <div className="text-[13px] font-bold text-ink">{l.day}</div>
                  {/* The real day type, when one has been set. This replaced
                      hard-coded "load in" on the first column and "load out" on
                      the last, which were positional guesses and simply wrong on
                      any run that opens with travel or ends with two load-out
                      days. Blank when unset — better than a confident lie. */}
                  {dayTypeLabel(dayTypes?.[date]) && (
                    <div className="truncate text-[9px] leading-tight text-accent">
                      {dayTypeLabel(dayTypes?.[date])}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {rooms.map(room => (
            <div
              key={room.key}
              className="grid border-b border-line last:border-b-0"
              style={{ gridTemplateColumns }}
            >
              <div className="sticky left-0 z-10 flex items-center gap-1 border-r border-line bg-surface px-2 py-2">
                <input
                  value={room.name}
                  onChange={e =>
                    onRoomsChange(rooms.map(r => (r.key === room.key ? { ...r, name: e.target.value } : r)))
                  }
                  placeholder="Room name"
                  disabled={readOnly}
                  aria-invalid={invalidRoomKeys?.includes(room.key) || undefined}
                  className={cn(
                    'min-w-0 flex-1 rounded-field border bg-surface-2 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-60',
                    // Marks a room whose positions would be discarded at create
                    // time — blank name, or a duplicate of another room's.
                    invalidRoomKeys?.includes(room.key) ? 'border-ot' : 'border-line',
                  )}
                />
                {rooms.length > 1 && !readOnly && (
                  <button
                    type="button"
                    onClick={() => removeRoom(room.key)}
                    aria-label={`Remove ${room.name || 'room'}`}
                    className="rounded-field px-1.5 text-sm text-muted hover:text-danger"
                  >
                    ×
                  </button>
                )}
              </div>

              {dates.map((date, day) => {
                const lines = cellLines(call, room.key, day)
                const isSelected = selected?.roomKey === room.key && selected.day === day
                const l = dayLabel(date)
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setSelected({ roomKey: room.key, day })}
                    className={cn(
                      'flex min-h-[54px] flex-col items-center justify-center gap-0.5 border-l border-line px-1 py-1.5 transition-colors',
                      l.isWeekend && 'bg-bg',
                      isSelected ? 'bg-accent-wash ring-1 ring-inset ring-accent' : 'hover:bg-surface-2',
                    )}
                  >
                    {lines.length === 0 ? (
                      <span className="text-[11px] text-muted">—</span>
                    ) : (
                      <>
                        <span className="text-[13px] font-bold text-ink">{cellCount(lines)}</span>
                        {/* Roles show at every width now. This used to be
                            sm:block, so a filled cell on a phone was a bare
                            number with no way to tell an A1 from a stagehand.
                            Affordable because the room column is sticky — the
                            reason day columns were kept narrow was to fit four
                            days plus the room name on a 375px screen, and that
                            stopped mattering once the name never scrolls away. */}
                        <span className="w-full truncate px-0.5 text-[9px] leading-tight text-muted">
                          {lines.map(x => (x.quantity > 1 ? `${x.quantity} ` : '') + x.role).join(', ')}
                        </span>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Cell editor, BELOW the grid — never over it.
          It sits ABOVE "+ Add another room" rather than under it: with several
          rooms on a phone the editor was rendering past the bottom of the
          viewport, so tapping a cell appeared to do nothing at all. The
          scrollIntoView below is the belt to that braces. */}
      {selected && !readOnly && (
        <div ref={editorRef} className="mt-3 rounded-card border border-accent bg-surface p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-ink">
              {selRoom?.name || 'Room'} · {dayLabel(dates[selected.day]).weekday} {dayLabel(dates[selected.day]).day}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-muted hover:text-ink"
            >
              Done
            </button>
          </div>

          {sel.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {sel.map(l => (
                <li
                  key={l.role}
                  className="flex items-center gap-1.5 rounded-pill border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-xs text-ink"
                >
                  <span className="font-semibold">{l.quantity}×</span> {l.role}
                  <button
                    type="button"
                    onClick={() => onChange(removeRole(call, selected.roomKey, selected.day, l.role))}
                    aria-label={`Remove ${l.role}`}
                    className="rounded-full px-1.5 text-muted hover:text-danger"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {roleSelect(addToSelected)}

          {/* The bulk actions. This is what replaces the scope dropdown. */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onChange(copyDayTo(call, selected.roomKey, selected.day,
                dates.map((_, i) => i)))}
              className="rounded-field border border-line px-2 py-1 text-[11px] text-muted hover:text-ink"
            >
              Copy to every day
            </button>
            {totalDays > 1 && (
              <button
                type="button"
                onClick={() => onChange(copyDayTo(call, selected.roomKey, selected.day,
                  [0, totalDays - 1]))}
                className="rounded-field border border-line px-2 py-1 text-[11px] text-muted hover:text-ink"
              >
                Copy to load in + load out
              </button>
            )}
            <button
              type="button"
              onClick={() => onChange(clearDay(call, selected.roomKey, selected.day))}
              className="rounded-field border border-line px-2 py-1 text-[11px] text-muted hover:text-danger"
            >
              Clear day
            </button>
          </div>
        </div>
      )}

      {!readOnly && (
        <button
          type="button"
          onClick={addRoom}
          className="mt-2 text-xs font-semibold text-accent hover:underline"
        >
          + Add another room
        </button>
      )}
    </div>
  )
}
