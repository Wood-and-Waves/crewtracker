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
import { normalizeActivities, type Activity } from '@/lib/dayActivities'
import DayActivitiesGrid from '@/components/DayActivitiesGrid'
import PositionDefsEditor from '@/components/PositionDefsEditor'
import PmField from '@/components/PmField'
import { derivedCounts, type PositionDef } from '@/lib/positionDefs'
import { cn } from '@/lib/cn'
import CrewCallGrid, { type GridRoom } from '@/components/CrewCallGrid'
import { roomDayIndices, validateRooms, type CallModel } from '@/lib/crewCallGrid'

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
  const [activities, setActivities] = useState<Record<string, Activity[]>>({})
  // Positions by KIND of day (piece B): the definitions; the per-day slots are
  // derived by the database after the show exists (sync_position_slots).
  const [defs, setDefs] = useState<PositionDef[]>([])
  // The production manager, if one is named now. Invited once the show exists;
  // the show reaches them only when they accept (piece B).
  const [pm, setPm] = useState<{ id: string; name: string } | null>(null)
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
  // Rooms carrying definitions also need a real, unique name — the definition
  // is keyed to the room by NAME in the database.
  const defRoomProblems = useMemo(() => {
    const withDefs = new Set(defs.map(d => d.roomKey))
    const names = new Map<string, number>()
    for (const r of rooms) { const n = r.name.trim().toLowerCase(); if (n) names.set(n, (names.get(n) ?? 0) + 1) }
    return rooms.filter(r => withDefs.has(r.key) && (!r.name.trim() || (names.get(r.name.trim().toLowerCase()) ?? 0) > 1)).map(r => r.key)
  }, [rooms, defs])
  const gridDays = useMemo(() => dates.map(date => ({ date, activities: activities[date] ?? [] })), [dates, activities])
  const preview = useMemo(
    () => derivedCounts(defs, gridDays, (roomKey, i) => roomDayIndices(call, roomKey, dates.length).includes(i)),
    [defs, gridDays, call, dates.length],
  )
  const badRoomKeys = useMemo(
    () => [...new Set([...roomProblems.blank, ...roomProblems.duplicate, ...defRoomProblems])],
    [roomProblems, defRoomProblems],
  )

  const canCreate =
    !!name.trim() && !!startDate && !!endDate && dates.length > 0 && !loading &&
    badRoomKeys.length === 0

  async function createShow() {
    // Naming a PM sends them an email, so it is asked out loud, once, before
    // anything is written. Not on a retry: the invitation went with the first
    // attempt or the person is already told where to send it from.
    if (pm && !createdShowId && !confirm(`Create the show and invite ${pm.name} as PM? They'll get an email and the show once they accept.`)) return
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

    // No activities when nobody tapped any. Never invent a default — a made-up
    // activity ends up on the tracker and in a booking request email. The
    // database mirrors day_type from this (migration 0032).
    const workDayRows = dates.map((date, i) => ({
      show_id: showId,
      date,
      day_number: i + 1,
      activities: activities[date] ?? [],
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

      void dayIdByIndex; void roomIdByNameAndDay
      // Positions by kind: write the DEFINITIONS, then let the database derive
      // the per-day slots from the day grid (piece B).
      const defRows = defs.flatMap((d, i) => {
        const roomName = nameByKey.get(d.roomKey)
        if (!roomName || !d.role.trim()) return []
        return [{
          show_id: showId, room_name: roomName, role: d.role.trim(), count: d.count,
          day_kind: d.dayKind, custom_dates: d.dayKind === 'custom' ? d.customDates : null, sort_order: i,
        }]
      })

      if (defRows.length > 0) {
        const { error: defError } = await supabase.from('position_defs').insert(defRows)
        const { error: syncError } = defError ? { error: null } : await supabase.rpc('sync_position_slots', { p_show_id: showId })
        const posError = defError ?? syncError
        // The show and its rooms exist by now, so this is reported rather than
        // failing the whole creation — sending someone back to an empty form
        // would lose everything they typed.
        if (posError) {
          setError(`Show created, but the positions didn't save: ${posError.message}`)
          setLoading(false)
          return
        }
      }

      if (pm) {
        const res = await fetch('/api/pm/invite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ showId, profileId: pm.id }),
        })
        const body = await res.json().catch(() => ({}))
        // Same shape as the positions above: the show exists, so report and
        // point at where to finish rather than fail the whole creation.
        if (!res.ok) {
          setError(`Show created, but ${pm.name} couldn't be named PM: ${body.error ?? 'unknown error'}. Name them on Edit Show.`)
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
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Production manager</p>
              <PmField pm={{ profileId: pm?.id ?? null, name: pm?.name ?? null, invitedAt: null, acceptedAt: null }} onPick={setPm} />
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
            title="Day activities"
            note={`${Object.values(activities).filter(a => a.length > 0).length} of ${dates.length} set · optional`}
            className="mb-4"
          />
          <DayActivitiesGrid
            rows={dates.map(date => ({ key: date, date }))}
            value={activities}
            onToggle={(date, a, next) => setActivities(prev => {
              const cur = prev[date] ?? []
              return { ...prev, [date]: normalizeActivities(next ? [...cur, a] : cur.filter(x => x !== a)) }
            })}
          />
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
        <section>
        <CrewCallGrid
          rooms={rooms}
          dates={dates}
          call={call}
          roles={roles}
          onChange={setCall}
          onRoomsChange={setRooms}
          schedulingEnabled={schedulingEnabled}
          dayActivities={activities}
          invalidRoomKeys={badRoomKeys}
          sectionNumber="4"
          derivedCounts={schedulingEnabled ? preview : undefined}
        />
        {schedulingEnabled && (
          <div className="mt-5">
            <p className="mb-2 text-xs text-muted">
              Say what each room needs and on which kinds of day; the grid above shows the days that works out to.
            </p>
            <PositionDefsEditor
              rooms={rooms}
              roles={roles}
              days={gridDays}
              defs={defs}
              onChange={setDefs}
            />
          </div>
        )}
        </section>
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
