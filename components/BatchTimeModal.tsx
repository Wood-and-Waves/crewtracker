'use client'

import { useState } from 'react'
import {
  PunchType,
  PUNCH_LABELS,
  BatchTimecard,
  isEligibleForBatch,
  ineligibilityReason,
} from '@/lib/punches'
import { zonedWallTimeToUtc } from '@/lib/datetime'
import { cn } from '@/lib/cn'
import Button from '@/components/ui/Button'

// Shared time-picker + crew checklist used by both batch entry paths:
//  - mode 'apply'  → PATH 1, pre-checks crew ELIGIBLE for a new punch
//  - mode 'change' → PATH 2 "Change All", pre-checks crew who already HAVE
//    this punch (to update their existing times)
export default function BatchTimeModal({
  type,
  mode,
  scope,
  dayDate,
  timezone,
  onCancel,
  onConfirm,
}: {
  type: PunchType
  mode: 'apply' | 'change'
  scope: BatchTimecard[]
  dayDate: string
  timezone: string
  onCancel: () => void
  onConfirm: (when: Date, checkedIds: Set<string>) => void
}) {
  // Default the time to the current wall-clock time in the show's timezone
  // (live punching), keeping the DATE on the show-day being viewed — never the
  // browser's real "today". Mirrors TimeEntryModal.
  const nowInTz = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  const [dateStr, setDateStr] = useState(dayDate)
  const [timeStr, setTimeStr] = useState(nowInTz)

  function initialChecked(tc: BatchTimecard): boolean {
    return mode === 'change'
      ? tc.punches.some(p => p.punch_type === type)
      : isEligibleForBatch(tc.punches, tc.is_travel_day, type)
  }

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(scope.filter(initialChecked).map(tc => tc.id))
  )

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirm() {
    // The entered wall-clock time means the SHOW's timezone, not the browser's.
    const when = zonedWallTimeToUtc(dateStr, timeStr, timezone)
    onConfirm(when, checked)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-card bg-surface border border-line shadow-xl flex flex-col max-h-[85vh]">
        <div className="p-6 pb-4">
          <h2 className="text-lg font-bold text-ink mb-1">{PUNCH_LABELS[type]} All</h2>
          <p className="text-xs text-muted mb-4">
            {mode === 'change'
              ? 'Update the time for everyone who already has this punch.'
              : 'Set the time and choose who gets this punch.'}
          </p>
          <div className="flex gap-3">
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
        </div>

        <div className="overflow-y-auto px-6 border-t border-line divide-y divide-line">
          {scope.map(tc => {
            const isChecked = checked.has(tc.id)
            const eligible = isEligibleForBatch(tc.punches, tc.is_travel_day, type)
            const reason = eligible ? null : ineligibilityReason(tc.punches, tc.is_travel_day, type)
            return (
              <label
                key={tc.id}
                className="flex items-center gap-3 py-3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(tc.id)}
                  className="h-5 w-5 rounded accent-accent shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium truncate', isChecked ? 'text-ink' : 'text-muted')}>
                    {tc.crew_member_name}
                  </p>
                  <p className="text-xs text-muted truncate">{tc.role}</p>
                </div>
                {mode === 'apply' && reason && (
                  <span className="text-[10px] uppercase tracking-wide text-muted/70 shrink-0">{reason}</span>
                )}
              </label>
            )
          })}
        </div>

        <div className="flex gap-3 p-6 pt-4 border-t border-line">
          <Button variant="ghost" className="flex-1 py-3" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 py-3" onClick={confirm} disabled={checked.size === 0}>
            Apply to {checked.size}
          </Button>
        </div>
      </div>
    </div>
  )
}
