'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PunchType, PUNCH_LABELS, Punch, getChronologyError } from '@/lib/punches'
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
  onClose,
}: {
  timecardId: string
  type: PunchType
  existingTime: string | null
  allPunches: Punch[]
  timezone: string
  showTravelToggle: boolean
  isTravelDay: boolean
  dayDate: string
  onClose: () => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [travelDay, setTravelDay] = useState(isTravelDay)

  // Default the date to the show-day being edited, NOT the browser's real
  // "today" — this was the source of a bug where new punches silently got
  // stamped on the wrong date, corrupting hour totals and short-turnaround
  // detection.
  const base = existingTime ? new Date(existingTime) : new Date(dayDate + 'T12:00:00')
  const [dateStr, setDateStr] = useState(existingTime ? base.toISOString().slice(0, 10) : dayDate)
  const [timeStr, setTimeStr] = useState(
    `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`
  )

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
    const combined = new Date(`${dateStr}T${timeStr}:00`)

    const otherPunches = allPunches.filter(p => p.punch_type !== type)
    const chronError = getChronologyError(combined, type, otherPunches)
    if (chronError) {
      setError(chronError)
      return
    }

    setLoading(true)
    const existing = allPunches.find(p => p.punch_type === type)
    const result = existing
      ? await supabase.from('punches').update({ punched_at: combined.toISOString() }).eq('id', existing.id)
      : await supabase.from('punches').insert({ timecard_id: timecardId, punch_type: type, punched_at: combined.toISOString() })

    setLoading(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    router.refresh()
    onClose()
  }

  async function clearPunch() {
    if (!confirm('Clear this punch? This cannot be undone.')) return
    const existing = allPunches.find(p => p.punch_type === type)
    if (!existing) return

    setLoading(true)
    const { error } = await supabase.from('punches').delete().eq('id', existing.id)
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
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
                className="flex-1 rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink outline-none focus:border-accent"
              />
              <input
                type="time"
                value={timeStr}
                onChange={e => setTimeStr(e.target.value)}
                className="flex-1 rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink outline-none focus:border-accent"
              />
            </div>

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
