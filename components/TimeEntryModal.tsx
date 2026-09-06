'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PunchType, PUNCH_LABELS, Punch, getChronologyError, roundWallTime } from '@/lib/punches'
import { zonedWallTimeToUtc, utcToZonedParts, addDays } from '@/lib/datetime'
import Button from '@/components/ui/Button'

export default function TimeEntryModal({
  timecardId,
  type,
  existingTime,
  allPunches,
  timezone,
  showTravelToggle,
  isTravelDay,
  dayDate,
  authorId,
  roundingMinutes,
  onClose,
  onSaved,
  onCleared,
}: {
  timecardId: string
  type: PunchType
  existingTime: string | null
  allPunches: Punch[]
  timezone: string
  showTravelToggle: boolean
  isTravelDay: boolean
  dayDate: string
  /** The signed-in PM. Recorded as the author of whatever this writes. */
  authorId: string
  /** organizations.timecard_rounding_minutes — every punch lands on it. */
  roundingMinutes: number
  onClose: () => void
  /**
   * The written punch, straight from the database's RETURNING. The row applies
   * it to its own state immediately, so the time appears the instant Save is
   * pressed instead of after a full page re-render. Optional so older call
   * sites keep working unchanged.
   */
  onSaved?: (punch: Punch & { source: 'staff' | 'crew' }) => void
  /** The punch type that was cleared, for the same reason. */
  onCleared?: (type: PunchType) => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [travelDay, setTravelDay] = useState(isTravelDay)

  // For a NEW punch, default the time to the current wall-clock time in the
  // show's timezone (so live punching pre-fills "now"), but keep the DATE on
  // the show-day being edited — never the browser's real "today". Defaulting
  // the date to real-today once produced 33.5-hour days and broke
  // short-turnaround detection when the viewed day wasn't today.
  //
  // For an EXISTING punch, BOTH fields come from the show's timezone in one
  // conversion. Taking the date from UTC and the time from the browser's clock
  // (as this used to) makes them disagree for any punch after ~7 PM Central,
  // so re-saving an untouched form moved the punch forward a full day.
  const nowInTz = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  const initial = existingTime
    ? utcToZonedParts(new Date(existingTime), timezone)
    : { dateStr: dayDate, timeStr: nowInTz }
  const [dateStr, setDateStr] = useState(initial.dateStr)
  const [timeStr, setTimeStr] = useState(initial.timeStr)

  async function handleTravelToggle(checked: boolean) {
    setTravelDay(checked)
    if (checked) {
      await supabase.from('timecards').update({ is_travel_day: true }).eq('id', timecardId)
      router.refresh()
      onClose()
    } else {
      await supabase.from('timecards').update({ is_travel_day: false }).eq('id', timecardId)
      router.refresh()
    }
  }

  async function save() {
    setError('')
    // Every punch in the app lands on the organization's grid, always rounded
    // UP — the same rule the crew clock applies, because a time typed by a PM
    // and a time tapped by crew must be worth the same thing.
    //
    // dayOffset matters: 23:58 on a quarter-hour grid rounds to 00:00 the NEXT
    // day, which is the right answer for an overnight wrap and an invalid
    // "24:00" if ignored.
    const { timeStr: gridTime, dayOffset } = roundWallTime(timeStr, roundingMinutes)
    // The entered wall-clock time means the SHOW's timezone, not the browser's.
    const combined = zonedWallTimeToUtc(addDays(dateStr, dayOffset), gridTime, timezone)

    const otherPunches = allPunches.filter(p => p.punch_type !== type)
    const chronError = getChronologyError(combined, type, otherPunches)
    if (chronError) {
      setError(chronError)
      return
    }

    setLoading(true)
    const existing = allPunches.find(p => p.punch_type === type)
    const written = { punched_at: combined.toISOString(), source: 'staff' as const, created_by: authorId }
    // .select() on the write for two reasons: a verified write (an UPDATE that
    // matches no policy returns success with zero rows — CLAUDE.md), and the
    // returned row is what the tracker row paints immediately.
    const result = existing
      // source/created_by are stamped on the UPDATE too, not just the insert:
      // a PM correcting a crew-entered time becomes its author, which both
      // keeps the Final Report's crew-entered count honest and stops the crew
      // link overwriting the correction (see app/api/clock/punch).
      ? await supabase.from('punches')
          .update(written)
          .eq('id', existing.id)
          .select('id, punch_type, punched_at, source')
      : await supabase.from('punches')
          .insert({ timecard_id: timecardId, punch_type: type, ...written })
          .select('id, punch_type, punched_at, source')

    setLoading(false)

    if (result.error) {
      setError(result.error.message)
      return
    }
    const row = (result.data ?? [])[0]
    if (!row) {
      setError('That did not save — you may not have permission to edit this timecard.')
      return
    }

    // Paint first, reconcile second. The row updates itself from `row` and the
    // modal closes at once; the page re-render that keeps the day totals and
    // the batch bar honest still happens, but no longer stands between the tap
    // and the time appearing. This is the "punches are the worst" fix.
    onSaved?.({ id: row.id, punch_type: row.punch_type, punched_at: row.punched_at, source: row.source })
    onClose()
    router.refresh()
  }

  async function clearPunch() {
    if (!confirm('Clear this punch? This cannot be undone.')) return
    const existing = allPunches.find(p => p.punch_type === type)
    if (!existing) return

    setLoading(true)
    const { data, error } = await supabase.from('punches').delete().eq('id', existing.id).select('id')
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }
    if (!data || data.length === 0) {
      setError('That did not clear — you may not have permission to edit this timecard.')
      return
    }

    onCleared?.(type)
    onClose()
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge">
        <h2 className="text-lg font-bold text-ink mb-4">{PUNCH_LABELS[type]}</h2>

        {showTravelToggle && (
          <label className="flex items-center gap-2 text-sm text-ink mb-4 pb-4 border-b border-line">
            <input
              type="checkbox"
              checked={travelDay}
              onChange={e => handleTravelToggle(e.target.checked)}
              className="h-4 w-4 rounded accent-accent"
            />
            Mark as Travel Day
          </label>
        )}

        {!travelDay && (
          <>
            <div className="flex gap-3 mb-4">
              <input
                type="date"
                value={dateStr}
                onChange={e => setDateStr(e.target.value)}
                className="flex-1 min-w-0 rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink outline-none focus:border-accent"
              />
              <input
                type="time"
                value={timeStr}
                step={roundingMinutes > 1 ? roundingMinutes * 60 : undefined}
                onChange={e => setTimeStr(e.target.value)}
                className="flex-1 min-w-0 rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink outline-none focus:border-accent"
              />
            </div>

            {/* Said out loud, because save() moves the typed time. A PM who
                enters 8:07 and finds 8:15 on the row without being told has
                been surprised by their own timesheet. */}
            {roundingMinutes > 1 && (
              <p className="-mt-2 mb-4 text-xs text-muted">
                Recorded in {roundingMinutes}-minute steps, always rounded up.
              </p>
            )}

            {error && <p className="text-xs text-danger mb-3">{error}</p>}

            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1 py-3" onClick={onClose}>Cancel</Button>
              {existingTime && (
                <Button variant="danger" className="flex-1 py-3" onClick={clearPunch} disabled={loading}>
                  Clear
                </Button>
              )}
              <Button className="flex-1 py-3" onClick={save} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
