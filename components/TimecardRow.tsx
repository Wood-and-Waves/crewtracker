'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PUNCH_ORDER, PUNCH_LABELS, nextPunchType, isWrapped, formatPunchTime, Punch, PunchType } from '@/lib/punches'
import { straightTimeHours, overtimeHours, doubleTimeHours, PayrollRuleset, TimecardLike } from '@/lib/payroll'
import TimeEntryModal from '@/components/TimeEntryModal'
import { cn } from '@/lib/cn'
import { PUNCH_GRID_COLS } from '@/lib/trackerLayout'

export default function TimecardRow({
  timecard,
  punches,
  timezone,
  ruleset,
  allTimecards,
  dayDate,
  use24Hour = false,
  roundingMinutes = 1,
}: {
  timecard: { id: string; crew_member_id: string | null; crew_member_name: string; role: string; day_rate: number; is_travel_day: boolean; travel_in_day: boolean; travel_out_day: boolean; pay_as_half_day: boolean }
  punches: Punch[]
  timezone: string
  ruleset: PayrollRuleset
  allTimecards: TimecardLike[]
  dayDate: string
  use24Hour?: boolean
  roundingMinutes?: number
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

  const st = wrapped ? straightTimeHours(timecardInput, allTimecards, ruleset, roundingMinutes) : 0
  const ot = wrapped ? overtimeHours(timecardInput, allTimecards, ruleset, roundingMinutes) : 0
  const dt = wrapped ? doubleTimeHours(timecardInput, allTimecards, ruleset, roundingMinutes) : 0

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

  function PunchCell({ type }: { type: PunchType }) {
    const done = punches.find(p => p.punch_type === type)
    const disabled = isDisabled(type)
    return (
      <button
        onClick={() => setEditingType(type)}
        disabled={disabled}
        className={cn(
          'rounded-card lg:rounded-field px-3 py-4 lg:px-2 lg:py-2 text-sm lg:text-xs font-medium transition-colors text-center tabular-nums',
          'flex flex-col items-center justify-center gap-0.5 min-h-[64px] lg:min-h-0 lg:block lg:gap-0',
          done && 'bg-surface-2 text-ink hover:opacity-90',
          !done && !disabled && 'bg-accent text-accent-ink font-semibold hover:opacity-90',
          disabled && 'text-muted/40 cursor-not-allowed',
        )}
      >
        <span className="lg:hidden block text-[9px] uppercase tracking-wide text-muted mb-0.5">
          {PUNCH_LABELS[type]}
        </span>
        {done ? formatPunchTime(done.punched_at, timezone, use24Hour) : PUNCH_LABELS[type]}
      </button>
    )
  }

  return (
    <div className="border-b border-line last:border-b-0">
      <div className={cn('p-4 grid grid-cols-3 gap-3', PUNCH_GRID_COLS, 'lg:items-center lg:gap-3 lg:py-3')}>
        {/* Who + totals + undo */}
        <div className="col-span-3 lg:col-span-1 flex items-center justify-between lg:block mb-2 lg:mb-0">
          <div>
            <p className="text-sm font-semibold text-ink">{timecard.crew_member_name}</p>
            <p className="text-xs text-muted">{timecard.role}</p>
          </div>
          <div className="flex items-center gap-2 lg:hidden">
            {punches.length > 0 && (
              <button onClick={undoLast} disabled={loading === 'undo'} className="text-xs text-muted hover:text-ink">
                ↶ Undo
              </button>
            )}
          </div>
        </div>

        {timecard.is_travel_day ? (
          <div className="col-span-3 lg:col-span-6 rounded-field bg-accent-wash text-accent text-center py-3 text-sm font-semibold">
            ✈ Travel Day
          </div>
        ) : (
          PUNCH_ORDER.map(type => <PunchCell key={type} type={type} />)
        )}

        <div className="col-span-3 lg:col-span-1 flex items-center justify-between lg:justify-end lg:flex-col lg:items-end mt-2 lg:mt-0 gap-2 lg:gap-0.5">
          {wrapped && (
            <p className="text-sm font-bold text-ink tabular-nums">
              {st.toFixed(2)} ST
              {ot > 0 && <span className="block text-xs font-semibold text-ot">+{ot.toFixed(2)} OT</span>}
              {dt > 0 && <span className="block text-xs font-semibold text-ot">{dt.toFixed(2)} DT</span>}
            </p>
          )}
          {punches.length > 0 && (
            <button onClick={undoLast} disabled={loading === 'undo'} className="hidden lg:block text-xs text-muted hover:text-ink">
              ↶ Undo
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 px-4 pb-3 lg:pb-3">
        <button
          onClick={() => toggleTravel('travel_in_day')}
          className={cn(
            'rounded-pill px-3 py-1 text-xs transition-colors',
            timecard.travel_in_day ? 'bg-accent-wash text-accent' : 'bg-surface-2 text-muted',
          )}
        >
          ✈ Travel In
        </button>
        <button
          onClick={() => toggleTravel('travel_out_day')}
          className={cn(
            'rounded-pill px-3 py-1 text-xs transition-colors',
            timecard.travel_out_day ? 'bg-accent-wash text-accent' : 'bg-surface-2 text-muted',
          )}
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
          dayDate={dayDate}
          onClose={() => setEditingType(null)}
        />
      )}
    </div>
  )
}
