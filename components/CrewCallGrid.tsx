'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import { dayTypeLabel, dayTypeBgClass } from '@/lib/dayTypes'
import { cn } from '@/lib/cn'
import PositionsBulkAdd from '@/components/PositionsBulkAdd'
import RolePicker from '@/components/RolePicker'
import NumberedHead from '@/components/ui/NumberedHead'
import {
  addRole, removeRole, clearDay, copyDayTo, cellLines, cellCount, peakPerDay,
  addLinesTo,
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
  sectionNumber,
  readOnly = false,
  schedulingEnabled = true,
}: {
  rooms: GridRoom[]
  dates: string[]
  call: CallModel
  roles: string[]
  onChange: (next: CallModel) => void
  /** Accepts an updater so add/remove can be safe against rapid clicks. */
  onRoomsChange: (next: GridRoom[] | ((prev: GridRoom[]) => GridRoom[])) => void
  /** Day type per DATE, for the column headers. Optional — unset days show none. */
  dayTypes?: Record<string, string>
  /** Rooms whose name would cost them their positions at create time. */
  invalidRoomKeys?: string[]
  /** Open Paper section number for the grid's NumberedHead ("4" on New Show). */
  sectionNumber?: string
  readOnly?: boolean
  /**
   * Scheduling module available. When FALSE this becomes a rooms-only editor:
   * the day columns, the cell editors and Add positions all disappear, leaving
   * just the room-name list.
   *
   * This component is the ONLY room editor on New Show, so it cannot simply be
   * hidden for an org without scheduling — there would be no way to create a
   * room at all. Collapsing it is deliberate rather than building a second
   * editor: the submit path already does the right thing, because
   * roomDayIndices() creates a room carrying no positions on EVERY day, which
   * is exactly the no-scheduling behaviour.
   */
  schedulingEnabled?: boolean
}) {
  const [selected, setSelected] = useState<{ roomKey: string; day: number } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement | null>(null)

  // Bring the editor into view when a cell is picked. 'nearest' rather than
  // 'center': on a desktop where it is already visible, centring would jolt the
  // page for no reason.
  useEffect(() => {
    if (selected) editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  // The draft role/quantity that used to live here moved into RolePicker,
  // which owns it — that state is meaningless outside adding one line.

  const totalDays = dates.length
  // Rooms-only mode: one full-width column, nothing to scroll sideways.
  const gridTemplateColumns = schedulingEnabled
    ? `${NAME_COL}px repeat(${totalDays}, minmax(${MIN_DAY_COL}px, 1fr))`
    : 'minmax(0, 1fr)'
  const minWidth = schedulingEnabled ? NAME_COL + totalDays * MIN_DAY_COL : undefined
  const perDay = peakPerDay(call, totalDays)

  function addRoom() {
    // Functional update, not [...rooms, x]: the array form reads whatever the
    // closure captured at render, so two clicks before React re-renders both
    // append to the SAME starting array and the second silently replaces the
    // first. Adding three rooms quickly gave you one.
    onRoomsChange(prev => [...prev, { key: crypto.randomUUID(), name: '' }])
  }

  function removeRoom(key: string) {
    onRoomsChange(prev => prev.filter(r => r.key !== key))
    const next = { ...call }
    delete next[key]
    onChange(next)
    if (selected?.roomKey === key) setSelected(null)
  }

  const sel = selected ? cellLines(call, selected.roomKey, selected.day) : []
  const selRoom = selected ? rooms.find(r => r.key === selected.roomKey) : null

  return (
    <div>
      <NumberedHead
        n={sectionNumber}
        title={schedulingEnabled ? 'Rooms & Positions' : 'Rooms'}
        note={
          !schedulingEnabled
            ? 'Each room is created on every day of the show'
            : perDay > 0 ? `${perDay} crew on the busiest day` : 'No positions yet'
        }
        className="mb-4"
      >
        {/* The labelled way in. Until this existed the only way to add a
            position was to discover that grid cells are clickable. */}
        {!readOnly && schedulingEnabled && (
          <Button
            type="button"
            size="sm"
            variant={perDay > 0 ? 'ghost' : 'primary'}
            onClick={() => { setBulkOpen(v => !v); setSelected(null) }}
          >
            {bulkOpen ? 'Close' : '+ Add positions'}
          </Button>
        )}
      </NumberedHead>

      {/* Opens above the grid, so the grid slides down and stays visible as the
          live preview of what this is about to do. */}
      {bulkOpen && !readOnly && schedulingEnabled && (
        <PositionsBulkAdd
          rooms={rooms}
          dates={dates}
          roles={roles}
          onClose={() => setBulkOpen(false)}
          onApply={(roomKeys, dayIndices, lines) =>
            onChange(addLinesTo(call, roomKeys, dayIndices, lines, totalDays))
          }
        />
      )}

      {/* Desktop grid — open paper: no wrapper box. The color-blocked header
          row anchors the table; a 3px ink rule closes it (on the last room
          row); hairlines carry the rows between. */}
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>
          <div className="grid" style={{ gridTemplateColumns }}>
            {/* Sticky room column, copied from ScheduleGrid which sits on
                identical scaffolding. Without it, scrolling right on a long run
                loses which room you are looking at. The opaque background is
                NOT optional: without it the day cells scroll visibly
                underneath — and here it is the band itself. */}
            <div className="sticky left-0 z-20 bg-band px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-band-ink">
              Room
            </div>
            {schedulingEnabled && dates.map((date, i) => {
              const l = dayLabel(date)
              const tint = dayTypeBgClass(dayTypes?.[date])
              return (
                <div
                  key={date}
                  className={cn(
                    'px-1 py-1.5 text-center',
                    // The column wears its day's color — the same tint chosen in
                    // Day Types above. Untyped days stay quiet; weekends get a
                    // wash only when untyped, since the tint outranks it.
                    tint ?? (l.isWeekend ? 'bg-surface-2/60' : 'bg-surface-2'),
                    tint && 'text-white',
                  )}
                >
                  <div className={cn('text-[9px] uppercase', tint ? 'text-white/80' : 'text-muted')}>{l.weekday}</div>
                  <div className={cn('text-[13px] font-bold', tint ? 'text-white' : 'text-ink')}>{l.day}</div>
                  {/* The real day type, when one has been set. This replaced
                      hard-coded "load in"/"load out" positional guesses. Blank
                      when unset — better than a confident lie. */}
                  {dayTypeLabel(dayTypes?.[date]) && (
                    <div className={cn('truncate font-display text-[9px] uppercase leading-tight', tint ? 'text-white' : 'text-accent')}>
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
              className="grid border-b border-line last:border-b-[3px] last:border-ink"
              style={{ gridTemplateColumns }}
            >
              <div className={cn(
                'flex items-center gap-1 bg-bg px-2 py-2',
                schedulingEnabled && 'sticky left-0 z-10 border-r border-line',
              )}>
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

              {schedulingEnabled && dates.map((date, day) => {
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
                      l.isWeekend && 'bg-surface-2/40',
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
      {selected && !readOnly && schedulingEnabled && (
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

          {/* The shared picker — the same control CallLinesEditor uses. This
              was a copy-pasted select/qty/Add trio with its own copy of the
              1-20 clamp and the iPad-Safari key workaround. */}
          <RolePicker
            roles={roles}
            onAdd={(r, q) => onChange(addRole(call, selected.roomKey, selected.day, r, q))}
          />

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
