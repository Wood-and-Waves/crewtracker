'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import {
  addRole, removeRole, clearDay, copyDayTo, cellLines, cellCount, peakPerDay,
  type CallModel,
} from '@/lib/crewCallGrid'
import { scopeIncludesDay, DAY_SCOPE_LABELS, type DayScope } from '@/lib/crewCall'

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
// Below 1024px the grid is abandoned entirely rather than squeezed. A rooms ×
// days grid needs ~72px a column to stay legible, so at 375px it shows three
// days — useless for a screen about a whole run. Mobile gets a per-room list
// with a "which days" control writing into the SAME model, which is why
// scopeIncludesDay survives.

export type GridRoom = { key: string; name: string }

const NAME_COL = 176
const MIN_DAY_COL = 74

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
  readOnly = false,
}: {
  rooms: GridRoom[]
  dates: string[]
  call: CallModel
  roles: string[]
  onChange: (next: CallModel) => void
  onRoomsChange: (next: GridRoom[]) => void
  readOnly?: boolean
}) {
  const [selected, setSelected] = useState<{ roomKey: string; day: number } | null>(null)
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [scope, setScope] = useState<DayScope>('all')

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

  // Mobile: one add applies across whichever days the scope names.
  function addByScope(roomKey: string) {
    if (!role) return
    let next = call
    for (let i = 0; i < totalDays; i++) {
      if (scopeIncludesDay(scope, i, totalDays)) next = addRole(next, roomKey, i, role, quantity)
    }
    onChange(next)
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
        <span className="text-xs uppercase tracking-wide text-muted">Rooms &amp; crew call</span>
        <span className="text-xs text-muted">
          {perDay > 0 ? `${perDay} crew on the busiest day` : 'No positions yet'}
        </span>
      </div>

      {/* Desktop grid */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface lg:block">
        <div style={{ minWidth }}>
          <div className="grid border-b border-line bg-surface-2" style={{ gridTemplateColumns }}>
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
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
                  {i === 0 && <div className="text-[9px] text-accent">load in</div>}
                  {i === totalDays - 1 && totalDays > 1 && (
                    <div className="text-[9px] text-accent">load out</div>
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
              <div className="flex items-center gap-1 px-2 py-2">
                <input
                  value={room.name}
                  onChange={e =>
                    onRoomsChange(rooms.map(r => (r.key === room.key ? { ...r, name: e.target.value } : r)))
                  }
                  placeholder="Room name"
                  disabled={readOnly}
                  className="min-w-0 flex-1 rounded-field border border-line bg-surface-2 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-60"
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

      {!readOnly && (
        <button
          type="button"
          onClick={addRoom}
          className="mt-2 hidden text-xs font-semibold text-accent hover:underline lg:block"
        >
          + Add another room
        </button>
      )}

      {/* Cell editor, BELOW the grid — never over it. */}
      {selected && !readOnly && (
        <div className="mt-3 hidden rounded-card border border-accent bg-surface p-3 lg:block">
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

      {/* Below 1024px: per-room list, same model, different shape. */}
      <div className="space-y-2 lg:hidden">
        {rooms.map(room => {
          const summary = dates
            .map((_, i) => cellCount(cellLines(call, room.key, i)))
            .reduce((a, b) => Math.max(a, b), 0)
          return (
            <div key={room.key} className="rounded-card border border-line bg-surface p-3">
              <div className="mb-2 flex gap-2">
                <input
                  value={room.name}
                  onChange={e =>
                    onRoomsChange(rooms.map(r => (r.key === room.key ? { ...r, name: e.target.value } : r)))
                  }
                  placeholder="Room name"
                  disabled={readOnly}
                  className="min-w-0 flex-1 rounded-field border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
                />
                {rooms.length > 1 && !readOnly && (
                  <button
                    type="button"
                    onClick={() => removeRoom(room.key)}
                    aria-label={`Remove ${room.name || 'room'}`}
                    className="px-2 text-sm text-muted hover:text-danger"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="mb-2 space-y-1">
                {dates.map((date, i) => {
                  const lines = cellLines(call, room.key, i)
                  if (lines.length === 0) return null
                  const l = dayLabel(date)
                  return (
                    <div key={date} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-muted">{l.weekday} {l.day}</span>
                      <span className="min-w-0 flex-1 truncate text-right text-ink">
                        {lines.map(x => `${x.quantity}× ${x.role}`).join(', ')}
                      </span>
                      <button
                        type="button"
                        onClick={() => onChange(clearDay(call, room.key, i))}
                        aria-label={`Clear ${l.weekday} ${l.day}`}
                        className="text-muted hover:text-danger"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
                {summary === 0 && <p className="text-xs text-muted">No positions yet.</p>}
              </div>

              {!readOnly && (
                <>
                  {roleSelect(() => addByScope(room.key))}
                  {totalDays > 1 && (
                    <select
                      value={scope}
                      onChange={e => setScope(e.target.value as DayScope)}
                      aria-label="Which days this role is needed"
                      className="mt-1.5 w-full rounded-field border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                    >
                      {(Object.keys(DAY_SCOPE_LABELS) as DayScope[]).map(k => (
                        <option key={k} value={k} className="bg-surface-2 text-ink">
                          {DAY_SCOPE_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          )
        })}
        {!readOnly && (
          <button
            type="button"
            onClick={addRoom}
            className="text-xs font-semibold text-accent hover:underline"
          >
            + Add another room
          </button>
        )}
      </div>
    </div>
  )
}
