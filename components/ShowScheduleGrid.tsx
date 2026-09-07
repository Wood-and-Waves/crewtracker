'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Select from '@/components/ui/Select'
import { BAND } from '@/lib/panel'
import { cn } from '@/lib/cn'
import { dayTypeBgClass, dayTypeLabel } from '@/lib/dayTypes'
import { cellStateOf, CELL_LABELS, type CellState, type GridTimecard } from '@/lib/scheduleGrid'

// Who works which days, in which room, with their own travel dates — one grid
// (Section 4 of the 2026-09-06 spec). A cell IS a timecard: the same row the
// tracker's Staff room creates and Reset deletes, so this and the tracker can
// never disagree. Desktop first (Dan): verified at laptop width; on a phone
// the grid scrolls inside itself, never the page.
//
// Same family as New Show's positions grid (CrewCallGrid): day headers tinted
// by day type, a sticky first column, hairline rows closed by a 3px rule.

type Day = { id: string; date: string; day_number: number; day_type: string | null }
type RoomDay = { id: string; name: string; work_day_id: string }

const STATE_CLASS: Record<CellState, string> = {
  empty: 'bg-bg text-muted/40',
  work: 'bg-accent text-accent-ink',
  travel_in: 'bg-day-travel text-white',
  travel_out: 'bg-day-travel text-white',
  travel: 'bg-day-travel/60 text-white',
}
const STATE_GLYPH: Record<CellState, string> = { empty: '', work: '●', travel_in: '→', travel_out: '←', travel: '✈' }

// Fixed to en-US so the server and the browser agree (a locale mismatch is a
// hydration warning); the tracker's day strip does the same.
function dayHead(date: string) {
  const d = new Date(date + 'T00:00:00')
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    long: d.toLocaleDateString('en-US', { weekday: 'long' }),
  }
}

function initials(name: string) {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function ShowScheduleGrid({
  showId, organizationId, days, rooms, timecards: initial, locked, canEdit, canEditRates = false,
}: {
  showId: string
  organizationId: string
  days: Day[]
  /** Every room-DAY on the show: a room is a per-day row in the database. */
  rooms: RoomDay[]
  /** Live timecards (declined excluded), with flags, absence and punch count. */
  timecards: GridTimecard[]
  locked: boolean
  canEdit: boolean
  canEditRates?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [timecards, setTimecards] = useState(initial)
  const [error, setError] = useState('')
  void router; void supabase; void setTimecards; void setError; void showId; void organizationId; void canEditRates

  // Room NAMES, across every day.
  const roomNames = useMemo(() => [...new Set(rooms.map(r => r.name))].sort((a, b) => a.localeCompare(b)), [rooms])
  const [roomName, setRoomName] = useState(roomNames[0] ?? '')
  const roomIdOn = (dayId: string, name: string) => rooms.find(r => r.work_day_id === dayId && r.name === name)?.id ?? null
  const roomById = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms])
  const dayOfRoom = (roomId: string) => roomById.get(roomId)?.work_day_id

  // People, one row each, by directory id (name as the fallback key for
  // historical cards with no id — the same key Reports use).
  const people = useMemo(() => {
    const byKey = new Map<string, { key: string; crewMemberId: string | null; name: string; role: string }>()
    for (const t of timecards) {
      const key = t.crew_member_id ?? t.crew_member_name
      if (!byKey.has(key)) byKey.set(key, { key, crewMemberId: t.crew_member_id, name: t.crew_member_name, role: t.role })
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [timecards])

  // This person's card on this day, preferring the selected room.
  function cardFor(personKey: string, dayId: string): GridTimecard | undefined {
    const mine = timecards.filter(t => (t.crew_member_id ?? t.crew_member_name) === personKey && dayOfRoom(t.room_id) === dayId)
    const selected = roomIdOn(dayId, roomName)
    return mine.find(t => t.room_id === selected) ?? mine[0]
  }

  const gridTemplateColumns = `220px repeat(${days.length}, minmax(64px, 1fr))`

  return (
    <section id="schedule" className="mb-8">
      <div className={cn(BAND, 'flex flex-wrap items-center justify-between gap-3 px-4 py-2')}>
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Schedule</h2>
        {roomNames.length > 1 && (
          <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-band-ink/80">
            Room
            <Select ariaLabel="Room" size="sm" value={roomName} onChange={setRoomName}
              options={roomNames.map(n => ({ value: n, label: n }))} />
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: 220 + days.length * 64 }}>
          <div className="grid border-b-2 border-ink" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-20 bg-surface-2 px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Crew</div>
            {days.map(d => {
              const h = dayHead(d.date)
              const tint = dayTypeBgClass(d.day_type)
              const roomExists = roomIdOn(d.id, roomName) !== null
              return (
                <div
                  key={d.id}
                  title={roomExists ? undefined : `${roomName} is not on ${h.long} yet — tapping a cell adds it`}
                  className={cn('px-1 py-1.5 text-center', tint ?? 'bg-surface-2', tint && 'text-white', !roomExists && 'opacity-50')}
                >
                  <div className={cn('text-[9px] uppercase', tint ? 'text-white/80' : 'text-muted')}>{h.weekday}</div>
                  <div className={cn('text-[13px] font-bold', tint ? 'text-white' : 'text-ink')}>{h.day}</div>
                  {dayTypeLabel(d.day_type) && (
                    <div className={cn('truncate font-display text-[9px] uppercase leading-tight', tint ? 'text-white' : 'text-accent')}>
                      {dayTypeLabel(d.day_type)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {people.map(p => (
            <div key={p.key} className="grid border-b border-line last:border-b-[3px] last:border-ink" style={{ gridTemplateColumns }}>
              {/* Name over role, not beside it: side by side, a normal-length name
                  truncated at 220px on the first cut ("Avery F…"). */}
              <div className="sticky left-0 z-10 flex min-w-0 flex-col justify-center border-r border-line bg-bg px-3 py-1">
                <span className="truncate text-sm font-semibold leading-tight text-ink">{p.name}</span>
                <span className="truncate font-mono text-[10.5px] uppercase tracking-wide text-muted">{p.role}</span>
              </div>
              {days.map(d => {
                const card = cardFor(p.key, d.id)
                const state = cellStateOf(card)
                const room = card ? roomById.get(card.room_id) : undefined
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!canEdit || locked}
                    aria-label={`${p.name}, ${dayHead(d.date).long}: ${card?.absence ? card.absence : CELL_LABELS[state]}${room ? ` in ${room.name}` : ''}`}
                    className={cn(
                      'm-1 flex h-9 flex-col items-center justify-center rounded-field text-xs font-semibold transition-colors disabled:cursor-default',
                      card?.absence ? 'bg-surface-3 text-muted' : STATE_CLASS[state],
                      !card?.absence && state === 'empty' && canEdit && !locked && 'hover:bg-surface-2',
                    )}
                  >
                    {card?.absence ? (card.absence === 'cancelled' ? '⊘' : '✕') : STATE_GLYPH[state]}
                    {room && roomNames.length > 1 && <span className="text-[9px] font-normal opacity-80">{initials(room.name)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
          {people.length === 0 && (
            <p className="p-4 text-sm text-muted">Nobody is staffed yet.</p>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {locked && (
        <p className="mt-2 text-xs text-muted">Times are locked — the final report has been sent. An admin or the show’s PM can unlock the show.</p>
      )}
    </section>
  )
}
