'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PunchType, PUNCH_LABELS, Punch, getChronologyError } from '@/lib/punches'

export default function TimeEntryModal({
  timecardId,
  type,
  existingTime,
  allPunches,
  timezone,
  showTravelToggle,
  isTravelDay,
  onClose,
}: {
  timecardId: string
  type: PunchType
  existingTime: string | null
  allPunches: Punch[]
  timezone: string
  showTravelToggle: boolean
  isTravelDay: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [travelDay, setTravelDay] = useState(isTravelDay)

  const base = existingTime ? new Date(existingTime) : new Date()
  const [dateStr, setDateStr] = useState(base.toISOString().slice(0, 10))
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-6 shadow-xl">
        <h2 className="text-lg font-bold text-white mb-4">{PUNCH_LABELS[type]}</h2>

        {showTravelToggle && (
          <label className="flex items-center gap-2 text-sm text-zinc-300 mb-4 pb-4 border-b border-zinc-800">
            <input
              type="checkbox"
              checked={travelDay}
              onChange={e => handleTravelToggle(e.target.checked)}
              className="h-4 w-4 rounded"
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
                className="flex-1 rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="time"
                value={timeStr}
                onChange={e => setTimeStr(e.target.value)}
                className="flex-1 rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 rounded-lg border border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-500">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={loading}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
