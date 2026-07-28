'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/datetime'
import { pickRulesetValues, type RulesetValues } from '@/lib/ruleset'
import { SHOW_TIMEZONES, DEFAULT_SHOW_TIMEZONE } from '@/lib/timezones'
import Button from '@/components/ui/Button'
import CrewCallGrid, { type GridRoom } from '@/components/CrewCallGrid'
import { plannedPositions, roomDayIndices, type CallModel } from '@/lib/crewCallGrid'

// Creating a show, as a page rather than a dialog.
//
// It was a modal until the rooms-and-crew-call section made it taller than a
// 720px laptop viewport and put Create Show off-screen with no way to reach it —
// the dialog is fixed and centred, so the overflow was unreachable rather than
// scrolled. Capping the height and scrolling was a patch on a container that is
// simply the wrong shape for a two-dimensional crew call.
//
// The action pill is fixed to the bottom (the pattern from EditShowClient), so
// the page never has to be scrolled to submit it however long the run gets.

type Preset = { id: string; name: string; is_default: boolean } & RulesetValues

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-2.5 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

// De-duplicated case-insensitively, keeping the FIRST of a pair so whichever
// call was built first survives. Not cosmetic: rooms have no uniqueness
// constraint in the database, and the same room twice on one day is a bug this
// project already had to fix once in AddRoomModal.
function dedupeRooms(rows: GridRoom[]): GridRoom[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    const k = r.name.trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function datesBetween(start: string, end: string) {
  const dates: string[] = []
  const cur = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  // Guard against an end before the start, and against a typo like year 20265
  // generating an unbounded list.
  let guard = 0
  while (cur <= last && guard++ < 400) {
    // LOCAL calendar date — `cur` is local midnight, so toISOString() would
    // report the UTC date and shift every work day back for browsers ahead of UTC.
    dates.push(localDateStr(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

export default function NewShowClient({
  organizationId,
  roles,
  presets,
}: {
  organizationId: string
  roles: string[]
  presets: Preset[]
}) {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [cityState, setCityState] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [timezone, setTimezone] = useState(DEFAULT_SHOW_TIMEZONE)
  // Keys are counter-based rather than randomUUID: a random id generated in a
  // useState initializer differs between the server render and hydration.
  const [rooms, setRooms] = useState<GridRoom[]>([{ key: 'room-1', name: 'Main Stage' }])
  const [call, setCall] = useState<CallModel>({})
  const [presetId, setPresetId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setPresetId(presets.find(p => p.is_default)?.id ?? '')
  }, [presets])

  const dates = useMemo(
    () => (startDate && endDate ? datesBetween(startDate, endDate) : []),
    [startDate, endDate],
  )
  const chosen = presets.find(p => p.id === presetId) || null

  function summarize(p: Preset): string {
    const bits = [`OT after ${p.overtime_after_hours}h`]
    if (p.double_time_enabled) bits.push(`DT after ${p.double_time_after_hours}h`)
    if (p.continuous_time_enabled) bits.push('continuous time')
    if (p.meal_penalty_enabled) bits.push('meal penalties')
    if (p.short_turn_penalty_enabled) bits.push(`turnaround ${p.short_turn_rest_hours}h`)
    return bits.join(' · ')
  }

  const canCreate = !!name.trim() && !!startDate && !!endDate && dates.length > 0 && !loading

  async function createShow() {
    setError('')
    setLoading(true)

    const { data: show, error: showError } = await supabase
      .from('shows')
      .insert({
        organization_id: organizationId,
        name,
        venue: venue || null,
        city_state: cityState.trim() || null,
        start_date: startDate,
        end_date: endDate,
        timezone_identifier: timezone,
      })
      .select()
      .single()

    if (showError || !show) {
      setError(showError?.message || 'Failed to create show')
      setLoading(false)
      return
    }

    const workDayRows = dates.map((date, i) => ({ show_id: show.id, date, day_number: i + 1 }))

    // The preset's values are COPIED in rather than referenced. The show owns
    // its rules from here, so editing or deleting the preset later can never
    // rewrite hours and pay on a show that already exists.
    const rulesetRow = chosen
      ? { show_id: show.id, ...pickRulesetValues(chosen) }
      : { show_id: show.id }

    const [rulesetResult, daysResult] = await Promise.all([
      supabase.from('payroll_rulesets').insert(rulesetRow),
      supabase.from('work_days').insert(workDayRows).select('id, day_number'),
    ])

    if (rulesetResult.error) { setError(rulesetResult.error.message); setLoading(false); return }
    if (daysResult.error) { setError(daysResult.error.message); setLoading(false); return }

    const wanted = dedupeRooms(rooms)
    const finalRooms: GridRoom[] = wanted.length > 0
      ? wanted
      : [{ key: rooms[0]?.key ?? 'room-1', name: 'Main Stage' }]

    const days = (daysResult.data || []).slice().sort((a, b) => a.day_number - b.day_number)
    const totalDays = days.length

    // A room exists ONLY on the days it is called. created_at is nudged by the
    // room's index in the grid — not by its position within a day — so the
    // tracker (which orders rooms by created_at) shows them in the same order on
    // every day, even when a room is absent from some of them.
    const roomRows: { work_day_id: string; name: string; created_at: string }[] = []
    const base = Date.now()
    finalRooms.forEach((room, roomIndex) => {
      for (const dayIndex of roomDayIndices(call, room.key, totalDays)) {
        const day = days[dayIndex]
        if (!day) continue
        roomRows.push({
          work_day_id: day.id,
          name: room.name.trim(),
          created_at: new Date(base + roomIndex).toISOString(),
        })
      }
    })

    if (roomRows.length > 0) {
      const { data: createdRooms, error: roomsError } = await supabase
        .from('rooms').insert(roomRows).select('id, name, work_day_id')
      if (roomsError) { setError(roomsError.message); setLoading(false); return }

      // Map a (room, day) back to the row that was just created. Rooms are
      // identified by name within a day, which is exactly what dedupeRooms
      // guarantees is unique.
      const dayIdByIndex = new Map(days.map((d, i) => [i, d.id]))
      const roomIdByNameAndDay = new Map(
        (createdRooms ?? []).map((r: any) => [`${r.name}|${r.work_day_id}`, r.id]),
      )
      const nameByKey = new Map(finalRooms.map(r => [r.key, r.name.trim()]))

      const positionRows = plannedPositions(call, totalDays).flatMap(p => {
        const roomName = nameByKey.get(p.roomKey)
        const dayId = dayIdByIndex.get(p.dayIndex)
        if (!roomName || !dayId) return []
        const roomId = roomIdByNameAndDay.get(`${roomName}|${dayId}`)
        if (!roomId) return []
        return [{ room_id: roomId, role: p.role, sort_order: p.sortOrder }]
      })

      if (positionRows.length > 0) {
        const { error: posError } = await supabase.from('crew_call_positions').insert(positionRows)
        // The show and its rooms exist by now, so this is reported rather than
        // failing the whole creation — sending someone back to an empty form
        // would lose everything they typed.
        if (posError) {
          setError(`Show created, but the crew call didn't save: ${posError.message}`)
          setLoading(false)
          return
        }
      }
    }

    router.push(`/dashboard/shows/${show.id}`)
  }

  return (
    <div className="p-6 pb-44 md:p-10 lg:pb-32">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
      <h1 className="mb-6 mt-2 text-2xl font-extrabold tracking-tight md:text-3xl">New show</h1>

      {error && (
        <div className="mb-4 rounded-field border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
        <div className="mb-4 rounded-card border border-line bg-surface p-4 lg:mb-0">
          <p className="mb-3 text-xs uppercase tracking-wide text-muted">Show details</p>
          <input placeholder="Show name" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input placeholder="Venue (optional)" value={venue} onChange={e => setVenue(e.target.value)} className={inputCls} />
            <input placeholder="City & State" value={cityState} onChange={e => setCityState(e.target.value)} className={inputCls} />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input type="date" aria-label="Start date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
            <input type="date" aria-label="End date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
            <select value={timezone} onChange={e => setTimezone(e.target.value)} className={inputCls}>
              {SHOW_TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value} className="bg-surface-2 text-ink">{tz.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-4">
          <p className="mb-3 text-xs uppercase tracking-wide text-muted">Payroll rules</p>
          <select
            key={presets.map(p => p.id).join(',')}
            value={presetId}
            onChange={e => setPresetId(e.target.value)}
            className={inputCls}
          >
            <option value="" className="bg-surface-2 text-ink">Custom — start from scratch</option>
            {presets.map(p => (
              <option key={p.id} value={p.id} className="bg-surface-2 text-ink">
                {p.name}{p.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted">
            {chosen
              ? summarize(chosen)
              : 'OT after 10h, no double time, no meal penalties, no short turnaround. Set them per-show in Edit Show.'}
          </p>
        </div>
      </div>

      {dates.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Set the start and end dates to build the crew call.
        </p>
      ) : (
        <CrewCallGrid
          rooms={rooms}
          dates={dates}
          call={call}
          roles={roles}
          onChange={setCall}
          onRoomsChange={setRooms}
        />
      )}

      {/* A bar on mobile, a floating pill on desktop.
          A centred pill works on a wide screen where it lands below the content,
          but on a tall phone form it floats over whatever happens to be at that
          height — it was sitting on top of the crew call grid. A full-width bar
          with its own background reads as chrome instead of debris, and it sits
          above the tab-bar, since two fixed-bottom elements otherwise collide. */}
      <div className="fixed inset-x-0 bottom-20 z-40 border-t border-line bg-bg px-4 py-3 lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-auto lg:-translate-x-1/2 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
        <Button onClick={createShow} disabled={!canCreate} className="w-full lg:w-auto">
          {loading ? 'Creating…' : 'Create show'}
        </Button>
      </div>
    </div>
  )
}
