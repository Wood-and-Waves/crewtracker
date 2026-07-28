'use client'

import { useEffect, useState } from 'react'
import CallLinesEditor, { type CallLine } from '@/components/CallLinesEditor'
import { scopeIncludesDay } from '@/lib/crewCall'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/datetime'
import { pickRulesetValues, type RulesetValues } from '@/lib/ruleset'
import { SHOW_TIMEZONES, DEFAULT_SHOW_TIMEZONE } from '@/lib/timezones'
import Button from '@/components/ui/Button'

type Preset = { id: string; name: string; is_default: boolean } & RulesetValues

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

// Named rooms, de-duplicated case-insensitively, falling back to a single
// "Main Stage" so a show is never created with no rooms at all — which left the
// tracker with nothing to punch against until one was added by hand.
//
// The de-duplication is not cosmetic: rooms have no uniqueness constraint in
// the database, and the same room twice on one day is a bug this project has
// already had to fix once in AddRoomModal. Keeping the FIRST of a pair keeps
// whichever call the person built first.
function dedupeRooms<T extends { name: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const unique = rows.filter(r => {
    const k = r.name.trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
  return unique
}

function datesBetween(start: string, end: string) {
  const dates: string[] = []
  const cur = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  while (cur <= last) {
    // Read the LOCAL calendar date — `cur` is local midnight, so toISOString()
    // would report the UTC date and shift every work day back a day for any
    // browser ahead of UTC.
    dates.push(localDateStr(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

export default function NewShowModal({ organizationId }: { organizationId: string }) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [cityState, setCityState] = useState('')
  // Rooms carry their call with them. Dan: "Create Show, Rooms, and # of
  // positions all in one clean sweep" — the person building the show knows what
  // each room needs, and making them come back afterwards through each room's
  // menu is a separate errand for the same decision.
  const [rooms, setRooms] = useState<{ name: string; lines: CallLine[] }[]>([
    { name: 'Main Stage', lines: [] },
  ])
  const [roles, setRoles] = useState<string[]>([])
  const [timezone, setTimezone] = useState(DEFAULT_SHOW_TIMEZONE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Payroll presets: picking one COPIES its rules into this show's ruleset.
  // '' means "Custom" — start from the plain column defaults, the old behaviour.
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetId, setPresetId] = useState('')

  useEffect(() => {
    if (!open) return
    supabase
      .from('payroll_presets')
      .select('*')
      .eq('organization_id', organizationId)
      .order('sort_order')
      .then(({ data }) => {
        const list = (data || []) as Preset[]
        setPresets(list)
        // Pre-select the org's default preset, if it has one.
        setPresetId(list.find(p => p.is_default)?.id ?? '')
      })
  }, [open, organizationId])

  const chosen = presets.find(p => p.id === presetId) || null

  function summarize(p: Preset): string {
    const bits = [`OT after ${p.overtime_after_hours}h`]
    if (p.double_time_enabled) bits.push(`DT after ${p.double_time_after_hours}h`)
    if (p.continuous_time_enabled) bits.push('continuous time')
    if (p.meal_penalty_enabled) bits.push('meal penalties')
    if (p.short_turn_penalty_enabled) bits.push(`turnaround ${p.short_turn_rest_hours}h`)
    return bits.join(' · ')
  }

  useEffect(() => {
    if (!open) return
    let active = true
    supabase.from('av_roles').select('name').order('sort_order').then(({ data }) => {
      if (active) setRoles((data ?? []).map((r: any) => r.name))
    })
    return () => { active = false }
  }, [open])

  // Days in the run, from the dates already typed. Zero until both are set,
  // which is why the scope picker only appears once there is a run to scope to.
  const runLength = (() => {
    if (!startDate || !endDate) return 0
    const a = new Date(startDate + 'T00:00:00')
    const b = new Date(endDate + 'T00:00:00')
    const n = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
    return n > 0 ? n : 0
  })()

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

    const dates = datesBetween(startDate, endDate)
    const workDayRows = dates.map((date, i) => ({
      show_id: show.id,
      date,
      day_number: i + 1,
    }))

    // Copy the preset's values in rather than referencing it. The show owns its
    // rules from here on, so editing or deleting the preset later can never
    // rewrite the hours and pay on a show that already exists.
    const rulesetRow = chosen
      ? { show_id: show.id, ...pickRulesetValues(chosen) }
      : { show_id: show.id }

    const [rulesetResult, daysResult] = await Promise.all([
      supabase.from('payroll_rulesets').insert(rulesetRow),
      supabase.from('work_days').insert(workDayRows).select('id, day_number'),
    ])

    if (rulesetResult.error) {
      setError(rulesetResult.error.message)
      setLoading(false)
      return
    }
    if (daysResult.error) {
      setError(daysResult.error.message)
      setLoading(false)
      return
    }

    // Every day gets the same rooms, in the order they were typed — created_at
    // is nudged per room so the tracker (which orders by it) matches that order.
    const wanted = dedupeRooms(rooms.map(r => ({ name: r.name.trim(), lines: r.lines })))
    const finalRooms = wanted.length > 0 ? wanted : [{ name: 'Main Stage', lines: [] as CallLine[] }]
    const days = (daysResult.data || []).slice().sort((a, b) => a.day_number - b.day_number)
    const roomRows = days.flatMap(d =>
      finalRooms.map((r, i) => ({
        work_day_id: d.id,
        name: r.name,
        created_at: new Date(Date.now() + i).toISOString(),
      }))
    )

    if (roomRows.length > 0) {
      // Ids come back so each room's call can be attached; without them the
      // positions would have to be looked up by name afterwards.
      const { data: createdRooms, error: roomsError } = await supabase
        .from('rooms').insert(roomRows).select('id, name, work_day_id')
      if (roomsError) {
        setError(roomsError.message)
        setLoading(false)
        return
      }

      // The same call on every day of the show. That is the right default —
      // load-in and load-out often differ, but they are edited per day
      // afterwards, and starting from the full call is less work than building
      // each day from nothing.
      const linesByRoom = new Map(finalRooms.map(r => [r.name, r.lines]))
      // Which day each created room belongs to, so a line scoped to the first
      // or last day lands only there. Riggers on load-in and load-out is the
      // motivating case; without this the admin builds the show and then edits
      // two days by hand, which is the errand this whole panel removes.
      const dayIndexById = new Map(days.map((d, i) => [d.id, i]))
      const totalDays = days.length

      const positionRows = (createdRooms ?? []).flatMap(room => {
        const lines = linesByRoom.get(room.name) ?? []
        const dayIndex = dayIndexById.get(room.work_day_id)
        if (dayIndex === undefined) return []
        let order = 0
        // One row per position, never role-plus-quantity: each is individually
        // open or filled, and the person filling it attaches to that row.
        return lines
          .filter(line => scopeIncludesDay(line.scope, dayIndex, totalDays))
          .flatMap(line =>
            Array.from({ length: line.quantity }, () => ({
              room_id: room.id,
              role: line.role,
              sort_order: order++,
            })),
          )
      })

      if (positionRows.length > 0) {
        const { error: posError } = await supabase.from('crew_call_positions').insert(positionRows)
        // The show and its rooms exist by now, so this is reported rather than
        // treated as a failure of the whole creation — sending them back to an
        // empty form would lose everything they typed.
        if (posError) {
          setError(`Show created, but the crew call didn't save: ${posError.message}`)
          setLoading(false)
          return
        }
      }
    }

    setLoading(false)
    setOpen(false)
    router.push(`/dashboard/shows/${show.id}`)
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ New Show</Button>
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      {/* Scrolls, and must: the rooms-and-call section made this modal taller
          than a 720px laptop viewport, which put Create Show off-screen with no
          way to reach it. The dialog is centred and fixed, so without a
          max-height the overflow is simply unreachable rather than scrolled. */}
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-card bg-surface border border-line p-6 shadow-xl">
        <h2 className="text-xl font-bold text-ink mb-4">New Show</h2>

        <div className="flex flex-col gap-3">
          <input
            placeholder="Show name"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputCls}
          />
          <input
            placeholder="Venue (optional)"
            value={venue}
            onChange={e => setVenue(e.target.value)}
            className={inputCls}
          />
          <input
            placeholder="City & State (e.g. Chicago, IL)"
            value={cityState}
            onChange={e => setCityState(e.target.value)}
            className={inputCls}
          />
          <div className="flex gap-3">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
          </div>
          <select
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
            className={inputCls}
          >
            {SHOW_TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value} className="bg-surface-2 text-ink">{tz.label}</option>
            ))}
          </select>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted block mb-1">
              Rooms &amp; crew call
            </label>
            <div className="flex flex-col gap-2">
              {rooms.map((room, i) => (
                <div key={i} className="rounded-field border border-line p-2.5">
                  <div className="flex gap-2">
                    <input
                      placeholder="Room name"
                      value={room.name}
                      onChange={e => setRooms(rs => rs.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                      className="min-w-0 flex-1 rounded-field border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
                    />
                    {rooms.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRooms(rs => rs.filter((_, j) => j !== i))}
                        aria-label={`Remove ${room.name || 'room'}`}
                        className="rounded-field px-2 text-sm text-muted hover:text-danger"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="mt-2">
                    <CallLinesEditor
                      roles={roles}
                      lines={room.lines}
                      dayCount={runLength}
                      onChange={lines => setRooms(rs => rs.map((r, j) => j === i ? { ...r, lines } : r))}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRooms(rs => [...rs, { name: '', lines: [] }])}
              className="mt-2 text-xs font-semibold text-accent hover:underline"
            >
              + Add another room
            </button>
            <p className="text-xs text-muted mt-1">
              Rooms and their call are added to every day. You can change any day afterwards.
            </p>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted block mb-1">Payroll Rules</label>
            <select
              key={presets.map(p => p.id).join(',')}
              value={presetId}
              onChange={e => setPresetId(e.target.value)}
              className={inputCls}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id} className="bg-surface-2 text-ink">
                  {p.name}{p.is_default ? ' (default)' : ''}
                </option>
              ))}
              <option value="" className="bg-surface-2 text-ink">Custom — start from scratch</option>
            </select>
            <p className="text-xs text-muted mt-1">
              {chosen
                ? summarize(chosen)
                : 'OT after 10h, no double time, no meal penalties, no short turnaround. Set them per-show in Edit Show.'}
            </p>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1 py-3" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              className="flex-1 py-3"
              onClick={createShow}
              disabled={loading || !name || !startDate || !endDate}
            >
              {loading ? 'Creating...' : 'Create Show'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
