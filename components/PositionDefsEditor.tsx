'use client'

import Select from '@/components/ui/Select'
import { cn } from '@/lib/cn'
import {
  DAY_KINDS, DAY_KIND_LABELS, describeDefDays, type DayKind, type GridDay, type PositionDef,
} from '@/lib/positionDefs'

// Positions "by kind of day" (piece B of the 2026-09-07 show-flow spec).
// Sales says what they mean — "2 stagehands, load-in and load-out" — and the
// app works out the calendar days from the day grid. One block per room; each
// row is a definition: role, how many, which kind of day, and for Custom the
// dates themselves. The derived days are read back under each row so the
// choice is never abstract.
//
// Pure and controlled: New Show keeps the list in state until the show exists;
// Edit Show wraps it and saves each change. This component only reports.

const KIND_OPTIONS = DAY_KINDS.map(k => ({ value: k, label: DAY_KIND_LABELS[k] }))

function shortDay(date: string) {
  const d = new Date(date + 'T00:00:00')
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`
}

export default function PositionDefsEditor({
  rooms, roles, days, defs, onChange, readOnly = false,
}: {
  rooms: { key: string; name: string }[]
  roles: string[]
  days: GridDay[]
  defs: PositionDef[]
  onChange: (next: PositionDef[]) => void
  readOnly?: boolean
}) {
  const update = (key: string, patch: Partial<PositionDef>) =>
    onChange(defs.map(d => (d.key === key ? { ...d, ...patch } : d)))
  const remove = (key: string) => onChange(defs.filter(d => d.key !== key))
  const add = (roomKey: string) =>
    onChange([...defs, { key: crypto.randomUUID(), roomKey, role: roles[0] ?? '', count: 1, dayKind: 'all', customDates: [] }])

  const roleOptions = (current: string) => {
    const list = roles.includes(current) || !current ? roles : [current, ...roles]
    return [...(current ? [] : [{ value: '', label: 'Pick a role…' }]), ...list.map(r => ({ value: r, label: r }))]
  }

  return (
    <div className="flex flex-col gap-5">
      {rooms.map(room => {
        const mine = defs.filter(d => d.roomKey === room.key)
        return (
          <div key={room.key}>
            <div className="mb-1 border-b border-line pb-1">
              <span className="font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-ink">
                {room.name.trim() || 'Unnamed room'}
              </span>
            </div>
            {mine.length === 0 && (
              <p className="py-2 text-xs text-muted">No positions yet.</p>
            )}
            {mine.map(d => (
              <div key={d.key} className="border-b border-line py-2 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={d.count}
                    disabled={readOnly}
                    onChange={e => update(d.key, { count: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                    aria-label="How many"
                    className="w-14 rounded-field border border-line bg-surface-2 px-2 py-1.5 text-right text-sm text-ink tabular-nums outline-none focus:border-accent"
                  />
                  <span className="text-xs text-muted">×</span>
                  <Select
                    ariaLabel="Role"
                    size="sm"
                    className="min-w-[160px]"
                    value={d.role}
                    disabled={readOnly}
                    onChange={v => update(d.key, { role: v })}
                    options={roleOptions(d.role)}
                  />
                  <span className="text-xs text-muted">on</span>
                  <Select
                    ariaLabel="Which days"
                    size="sm"
                    className="min-w-[190px]"
                    value={d.dayKind}
                    disabled={readOnly}
                    onChange={v => update(d.key, { dayKind: v as DayKind })}
                    options={KIND_OPTIONS}
                  />
                  {!readOnly && (
                    <button type="button" onClick={() => remove(d.key)} aria-label="Remove position"
                      className="ml-auto rounded-field px-1.5 text-sm text-muted hover:text-danger">×</button>
                  )}
                </div>
                {d.dayKind === 'custom' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {days.map(day => {
                      const on = d.customDates.includes(day.date)
                      return (
                        <button
                          key={day.date}
                          type="button"
                          disabled={readOnly}
                          aria-pressed={on}
                          onClick={() => update(d.key, {
                            customDates: on ? d.customDates.filter(x => x !== day.date) : [...d.customDates, day.date].sort(),
                          })}
                          className={cn(
                            'rounded-pill border px-2.5 py-1 font-mono text-[11px] uppercase transition-colors',
                            on ? 'border-ink bg-ink text-bg' : 'border-line text-muted hover:text-ink',
                          )}
                        >
                          {shortDay(day.date)}
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-muted">
                  {d.role || 'Role'} · {describeDefDays(d, days)}
                </p>
              </div>
            ))}
            {/* Under the last row, where the eye is after adding one (Dan, 2026-09-07). */}
            {!readOnly && (
              <button type="button" onClick={() => add(room.key)} className="mt-1.5 text-xs font-semibold text-accent hover:underline">
                + Add position
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
