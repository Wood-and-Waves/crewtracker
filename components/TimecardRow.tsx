'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PUNCH_ORDER, PUNCH_LABELS, nextPunchType, isWrapped, formatPunchTime, Punch } from '@/lib/punches'

export default function TimecardRow({
  timecard,
  punches,
  timezone,
}: {
  timecard: { id: string; crew_member_name: string; role: string; travel_in_day: boolean; travel_out_day: boolean }
  punches: Punch[]
  timezone: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState<string | null>(null)

  const next = nextPunchType(punches)
  const wrapped = isWrapped(punches)

  async function punch(type: string) {
    setLoading(type)
    const { error } = await supabase
      .from('punches')
      .insert({ timecard_id: timecard.id, punch_type: type, punched_at: new Date().toISOString() })
    setLoading(null)
    if (!error) router.refresh()
  }

  async function undoLast() {
    if (punches.length === 0) return
    const last = punches[punches.length - 1]
    setLoading('undo')
    const { error } = await supabase.from('punches').delete().eq('id', last.id)
    setLoading(null)
    if (!error) router.refresh()
  }

  async function toggleTravel(field: 'travel_in_day' | 'travel_out_day') {
    const { error } = await supabase
      .from('timecards')
      .update({ [field]: !timecard[field] })
      .eq('id', timecard.id)
    if (!error) router.refresh()
  }

  return (
    <div className="rounded-lg bg-zinc-800/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-medium text-white">{timecard.crew_member_name}</p>
          <p className="text-xs text-zinc-500">{timecard.role}</p>
        </div>
        {punches.length > 0 && (
          <button
            onClick={undoLast}
            disabled={loading === 'undo'}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ↶ Undo
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {PUNCH_ORDER.map(type => {
          const done = punches.find(p => p.punch_type === type)
          const isNext = type === next
          return (
            <button
              key={type}
              onClick={() => punch(type)}
              disabled={!isNext || loading !== null}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                done
                  ? 'bg-zinc-700 text-zinc-300'
                  : isNext
                  ? 'bg-blue-600 text-white hover:bg-blue-500'
                  : 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
              }`}
            >
              {done ? formatPunchTime(done.punched_at, timezone) : PUNCH_LABELS[type as keyof typeof PUNCH_LABELS]}
            </button>
          )
        })}
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={() => toggleTravel('travel_in_day')}
          className={`rounded-full px-3 py-1 text-xs transition ${
            timecard.travel_in_day ? 'bg-blue-600/30 text-blue-300' : 'bg-zinc-900 text-zinc-500'
          }`}
        >
          ✈ Travel In
        </button>
        <button
          onClick={() => toggleTravel('travel_out_day')}
          className={`rounded-full px-3 py-1 text-xs transition ${
            timecard.travel_out_day ? 'bg-blue-600/30 text-blue-300' : 'bg-zinc-900 text-zinc-500'
          }`}
        >
          ✈ Travel Out
        </button>
      </div>
    </div>
  )
}
