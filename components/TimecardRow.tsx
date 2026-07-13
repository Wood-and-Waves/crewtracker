'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PUNCH_ORDER, PUNCH_LABELS, nextPunchType, isWrapped, formatPunchTime, Punch, PunchType } from '@/lib/punches'
import { straightTimeHours, overtimeHours, doubleTimeHours, PayrollRuleset, TimecardLike } from '@/lib/payroll'
import TimeEntryModal from '@/components/TimeEntryModal'

export default function TimecardRow({
  timecard,
  punches,
  timezone,
  ruleset,
  allTimecards,
}: {
  timecard: { id: string; crew_member_id: string | null; crew_member_name: string; role: string; day_rate: number; is_travel_day: boolean; travel_in_day: boolean; travel_out_day: boolean; pay_as_half_day: boolean }
  punches: Punch[]
  timezone: string
  ruleset: PayrollRuleset
  allTimecards: TimecardLike[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState<string | null>(null)
  const [editingType, setEditingType] = useState<PunchType | null>(null)

  const next = nextPunchType(punches)
  const wrapped = isWrapped(punches)

  const timecardInput: TimecardLike = {
    id: timecard.id,
    crew_member_id: timecard.crew_member_id,
    day_rate: timecard.day_rate,
    is_travel_day: timecard.is_travel_day,
    travel_in_day: timecard.travel_in_day,
    travel_out_day: timecard.travel_out_day,
    pay_as_half_day: timecard.pay_as_half_day,
    punches,
  }

  const st = wrapped ? straightTimeHours(timecardInput, allTimecards, ruleset) : 0
  const ot = wrapped ? overtimeHours(timecardInput, allTimecards, ruleset) : 0
  const dt = wrapped ? doubleTimeHours(timecardInput, allTimecards, ruleset) : 0

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

  function isDisabled(type: PunchType): boolean {
    const done = punches.find(p => p.punch_type === type)
    if (done) return false
    switch (type) {
      case 'start': return false
      case 'meal_out': return !punches.find(p => p.punch_type === 'start')
      case 'meal_in': return !punches.find(p => p.punch_type === 'meal_out')
      case 'meal2_out': return !punches.find(p => p.punch_type === 'meal_in')
      case 'meal2_in': return !punches.find(p => p.punch_type === 'meal2_out')
      case 'end': return !punches.find(p => p.punch_type === 'start')
    }
  }

  return (
    <div className="rounded-lg bg-zinc-800/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-medium text-white">{timecard.crew_member_name}</p>
          <p className="text-xs text-zinc-500">{timecard.role}</p>
        </div>
        <div className="flex items-center gap-2">
          {wrapped && (
            <p className="text-xs text-zinc-400">
              {st.toFixed(2)} ST{ot > 0 && ` / ${ot.toFixed(2)} OT`}{dt > 0 && ` / ${dt.toFixed(2)} DT`}
            </p>
          )}
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
      </div>

      {timecard.is_travel_day ? (
        <div className="rounded-lg bg-blue-600/10 text-blue-300 text-center py-3 text-sm font-semibold mb-2">
          ✈ Travel Day
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {PUNCH_ORDER.map(type => {
            const done = punches.find(p => p.punch_type === type)
            const disabled = isDisabled(type)
            return (
              <button
                key={type}
                onClick={() => setEditingType(type)}
                disabled={disabled}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                  done
                    ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                    : !disabled
                    ? 'bg-blue-600 text-white hover:bg-blue-500'
                    : 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
                }`}
              >
                {done ? formatPunchTime(done.punched_at, timezone) : PUNCH_LABELS[type]}
              </button>
            )
          })}
        </div>
      )}

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

      {editingType && (
        <TimeEntryModal
          timecardId={timecard.id}
          type={editingType}
          existingTime={punches.find(p => p.punch_type === editingType)?.punched_at || null}
          allPunches={punches}
          timezone={timezone}
          showTravelToggle={editingType === 'start'}
          isTravelDay={timecard.is_travel_day}
          onClose={() => setEditingType(null)}
        />
      )}
    </div>
  )
}
