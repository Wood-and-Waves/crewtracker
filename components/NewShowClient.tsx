'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/datetime'
import { pickRulesetValues, type RulesetValues } from '@/lib/ruleset'
import { SHOW_TIMEZONES, DEFAULT_SHOW_TIMEZONE } from '@/lib/timezones'
import Button from '@/components/ui/Button'
import NumberedHead from '@/components/ui/NumberedHead'
import Select from '@/components/ui/Select'
import { BAND } from '@/lib/panel'
import { DAY_TYPES, DAY_TYPE_LABELS, isDayType, dayTypeBgClass, type DayType } from '@/lib/dayTypes'
import { cn } from '@/lib/cn'
import CrewCallGrid, { type GridRoom } from '@/components/CrewCallGrid'
import { plannedPositions, roomDayIndices, validateRooms, type CallModel } from '@/lib/crewCallGrid'

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
  schedulingEnabled = true,
  organizationId,
  roles,
  presets,
}: {
  organizationId: string
  roles: string[]
  presets: Preset[]
  /** Scheduling module. False collapses section 4 to a rooms-only editor and
   *  skips the positions insert — see CrewCallGrid. */
  schedulingEnabled?: boolean
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
  // Keyed by DATE, not by index: the run shifts when the start or end date
  // changes, and a day that is still in the run should keep the type it was
  // given rather than inherit whatever the day in that position used to be.
  const [dayTypes, setDayTypes] = useState<Record<string, DayType>>({})
  const [presetId, setPresetId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Set once the shows row exists. Its presence means a retry must RESUME, not
  // insert a second show — and it is what lets the page offer a way into the
  // half-built show rather than stranding it.
  const [createdShowId, setCreatedShowId] = useState<string | null>(null)

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

  // Rooms that would lose their positions at create time. Blocking beats
  // silently discarding: the way to lose work here was to add a room, build a
  // three-role call in it, forget to type the name, and press Create.
  const roomProblems = useMemo(() => validateRooms(rooms, call), [rooms, call])
  const badRoomKeys = useMemo(
    () => [...roomProblems.blank, ...roomProblems.duplicate],
    [roomProblems],
  )

  const canCreate =
    !!name.trim() && !!startDate && !!endDate && dates.length > 0 && !loading &&
    badRoomKeys.length === 0

  async function createShow() {
    setError('')
    setLoading(true)

    // Creating a show is five round trips and there is no transaction, so a
    // failure part-way leaves a real show behind. Previously the only button on
    // screen then inserted a SECOND one. Reuse the show we already made instead:
    // the retry resumes rather than starting over.
    let showId: string

    if (createdShowId) {
      showId = createdShowId
    } else {
      const { data, error: showError } = await supabase
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
        .select('id')
        .single()

      if (showError || !data) {
        setError(showError?.message || 'Failed to create show')
        setLoading(false)
        return
      }
      showId = data.id
      setCreatedShowId(data.id)
    }

    // day_type is null when nobody picked one. Never invent a default — a made-up
    // day type ends up on the tracker and in a booking request email.
    const workDayRows = dates.map((date, i) => ({
      show_id: showId,
      date,
      day_number: i + 1,
      day_type: dayTypes[date] ?? null,
    }))

    // The preset's values are COPIED in rather than referenced. The show owns
    // its rules from here, so editing or deleting the preset later can never
    // rewrite hours and pay on a show that already exists.
    const rulesetRow = chosen
      ? { show_id: showId, ...pickRulesetValues(chosen) }
      : { show_id: showId }

    // On a RETRY some of this already landed, so read before writing. Blindly
    // re-inserting would hit the unique (show_id, date) on work_days, and would
    // silently duplicate the ruleset and every room. Each step below is
    // therefore "reuse what exists, otherwise create".
    const resuming = !!createdShowId
    const [priorDays, priorRuleset] = resuming
      ? await Promise.all([
          supabase.from('work_days').select('id, day_number').eq('show_id', showId),
          supabase.from('payroll_rulesets').select('id').eq('show_id', showId).maybeSingle(),
        ])
      : [null, null]

    if (!priorRuleset?.data) {
      const { error: rulesetError } = await supabase.from('payroll_rulesets').insert(rulesetRow)
      if (rulesetError) { setError(rulesetError.message); setLoading(false); return }
    }

    let daysData = priorDays?.data ?? null
    if (!daysData || daysData.length === 0) {
      const { data, error: daysError } = await supabase
        .from('work_days').insert(workDayRows).select('id, day_number')
      if (daysError) { setError(daysError.message); setLoading(false); return }
      daysData = data
    }
    const daysResult = { data: daysData }

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
      // Same reuse rule: if a previous attempt already made the rooms, read
      // them back for the position mapping instead of creating a second set.
      const dayIds = days.map(d => d.id)
      const prior = resuming && dayIds.length > 0
        ? await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', dayIds)
        : null

      let createdRooms = prior?.data ?? null
      if (!createdRooms || createdRooms.length === 0) {
        const { data, error: roomsError } = await supabase
          .from('rooms').insert(roomRows).select('id, name, work_day_id')
        if (roomsError) { setError(roomsError.message); setLoading(false); return }
        createdRooms = data
      }

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
          setError(`Show created, but the positions didn't save: ${posError.message}`)
          setLoading(false)
          return
        }
      }
    }

    router.push(`/dashboard/shows/${showId}`)
  }

  return (
    <div className="p-6 pb-44 md:p-10 lg:pb-32">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>

      {/* Open Paper masthead — a full-bleed ink band, not a heading floating on
          the page. Negative margins push it through the page padding so the
          slab runs edge to edge; the band token pair flips it to a lifted
          strip on the dark theme. */}
      <div className={cn(BAND, '-mx-6 md:-mx-10 mb-8 mt-3 px-6 py-5 md:px-10')}>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">New Show</h1>
      </div>

      {error && (
        <div className="mb-4 rounded-field border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <p>{error}</p>
          {/* The show exists even though this failed. Offer the way in rather
              than stranding it — pressing the button again resumes. */}
          {createdShowId && (
            <Link
              href={`/dashboard/shows/${createdShowId}`}
              className="mt-1 inline-block font-semibold underline"
            >
              Open the show anyway
            </Link>
          )}
        </div>
      )}

      {/* Named before the write, not tidied up during it. These rooms would
          otherwise be dropped at create time and take their positions with
          them, silently. */}
      {badRoomKeys.length > 0 && (
        <div className="mb-4 rounded-field border border-ot/30 bg-ot/10 px-4 py-3 text-sm text-ot">
          {roomProblems.blank.length > 0 && (
            <p>
              {roomProblems.blank.length === 1 ? 'A room has' : `${roomProblems.blank.length} rooms have`}
              {' '}positions but no name. Name {roomProblems.blank.length === 1 ? 'it' : 'them'} or
              {' '}remove {roomProblems.blank.length === 1 ? 'it' : 'them'} — otherwise
              {' '}{roomProblems.blank.length === 1 ? 'its' : 'their'} positions would be lost.
            </p>
          )}
          {roomProblems.duplicate.length > 0 && (
            <p>
              Two rooms share a name. Rooms are matched by name within a day, so the
              second one and its positions would be discarded.
            </p>
          )}
        </div>
      )}

      {/* Open Paper: numbered sections directly on the ground. The numbering is
          honest — creating a show IS a sequence — and the 3px rules carry the
          structure that enclosure used to fake. Nothing here has a wrapper. */}
      <section className="mb-9">
        <NumberedHead n="1" title="Show Details" className="mb-4" />
        <div>
            <input placeholder="Show name" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input placeholder="Venue (optional)" value={venue} onChange={e => setVenue(e.target.value)} className={inputCls} />
              <input placeholder="City & State" value={cityState} onChange={e => setCityState(e.target.value)} className={inputCls} />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input type="date" aria-label="Start date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
              <input type="date" aria-label="End date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
              <Select
                ariaLabel="Timezone"
                value={timezone}
                onChange={setTimezone}
                options={SHOW_TIMEZONES}
              />
            </div>
        </div>
      </section>

      <section className="mb-9">
        <NumberedHead n="2" title="Payroll Rules" className="mb-4" />
        <Select
          ariaLabel="Payroll preset"
          value={presetId}
          onChange={setPresetId}
          options={[
            { value: '', label: 'Custom — start from scratch' },
            ...presets.map(p => ({ value: p.id, label: `${p.name}${p.is_default ? ' (default)' : ''}` })),
          ]}
        />
        <p className="mt-2 text-xs text-muted">
          {chosen
            ? summarize(chosen)
            : 'OT after 10h, no double time, no meal penalties, no short turnaround. Set them per-show in Edit Show.'}
        </p>
      </section>

      {/* Day types as tiles: the tint bar on each is the day's color the moment
          it's chosen — the same color that will head its grid column below and
          follow the day onto the tracker. Columns keep a 20-day run from
          burying the positions grid (this screen is a laptop screen). */}
      {dates.length > 0 && (
        <section className="mb-9">
          <NumberedHead
            n="3"
            title="Day Types"
            note={`${Object.keys(dayTypes).length} of ${dates.length} set · optional`}
            className="mb-4"
          />
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {dates.map(date => (
              <div key={date}>
                <div className={cn('h-1.5 w-full', dayTypeBgClass(dayTypes[date]) ?? 'bg-line')} />
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="shrink-0 whitespace-nowrap font-mono text-xs font-semibold uppercase text-muted">
                    {new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                    })}
                  </span>
                  <Select
                    ariaLabel={`Day type for ${date}`}
                    size="sm"
                    className="w-[190px] shrink-0"
                    value={dayTypes[date] ?? ''}
                    onChange={v => setDayTypes(prev => {
                      const next = { ...prev }
                      if (isDayType(v)) next[date] = v
                      else delete next[date]
                      return next
                    })}
                    options={[
                      { value: '', label: '—' },
                      ...DAY_TYPES.map(t => ({
                        value: t,
                        label: DAY_TYPE_LABELS[t],
                        swatchClass: dayTypeBgClass(t),
                      })),
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {dates.length === 0 ? (
        <section>
          {/* Day Types hides until dates exist, so this is honestly section 3 here. */}
          <NumberedHead n="3" title="Rooms & Positions" className="mb-4" />
          <p className="py-6 text-sm text-muted">
            Set the start and end dates to add positions.
          </p>
        </section>
      ) : (
        <CrewCallGrid
          rooms={rooms}
          dates={dates}
          call={call}
          roles={roles}
          onChange={setCall}
          onRoomsChange={setRooms}
          schedulingEnabled={schedulingEnabled}
          dayTypes={dayTypes}
          invalidRoomKeys={badRoomKeys}
          sectionNumber="4"
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
          {/* "Try saving again" once the show exists: pressing this no longer
              creates a second one, and saying "Create show" would imply it did. */}
          {loading ? 'Saving…' : createdShowId ? 'Try saving again' : 'Create show'}
        </Button>
      </div>
    </div>
  )
}
