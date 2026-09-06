'use client'

import { useState } from 'react'
import {
  PunchType,
  PUNCH_LABELS,
  BatchTimecard,
  isEligibleForBatch,
  ineligibilityReason,
  roundWallTime,
} from '@/lib/punches'
import { zonedWallTimeToUtc, addDays } from '@/lib/datetime'
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
  roundingMinutes,
  onCancel,
  onConfirm,
}: {
  type: PunchType
  mode: 'apply' | 'change'
  scope: BatchTimecard[]
  dayDate: string
  /** organizations.timecard_rounding_minutes — every punch lands on it. */
  roundingMinutes: number
  timezone: string
  onCancel: () => void
  onConfirm: (when: Date, checkedIds: Set<string>, markTravel: boolean) => void
}) {
  // A travel day is usually a whole-room event — everyone flies in together.
  // iOS offers this on the Start sheet in both single and batch mode; without it
  // marking a room meant opening one modal per person. Start only, like iOS.
  const canMarkTravel = type === 'start'
  const [markTravel, setMarkTravel] = useState(false)
  // Default the time to the current wall-clock time in the show's timezone
  // (live punching), keeping the DATE on the show-day being viewed — never the
  // browser's real "today". Mirrors TimeEntryModal.
  // Pre-filled ALREADY on the company's grid, for the same reason as
  // TimeEntryModal: what the dialog shows is what save() will write.
  const nowInTz = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  const nowOnGrid = roundWallTime(nowInTz, roundingMinutes)
  const [dateStr, setDateStr] = useState(addDays(dayDate, nowOnGrid.dayOffset))
  const [timeStr, setTimeStr] = useState(nowOnGrid.timeStr)

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
    // Batch punches land on the organization's grid too — see TimeEntryModal.
    const { timeStr: gridTime, dayOffset } = roundWallTime(timeStr, roundingMinutes)
    // The entered wall-clock time means the SHOW's timezone, not the browser's.
    const when = zonedWallTimeToUtc(addDays(dateStr, dayOffset), gridTime, timezone)
    onConfirm(when, checked, canMarkTravel && markTravel)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm border-2 border-ink bg-surface shadow-edge flex flex-col max-h-[85vh]">
        <div className="p-6 pb-4">
          <h2 className="text-lg font-bold text-ink mb-1">{PUNCH_LABELS[type]} All</h2>
          <p className="text-xs text-muted mb-4">
            {mode === 'change'
              ? 'Update the time for everyone who already has this punch.'
              : markTravel
                ? 'Marks the checked crew as a travel day. No punches are recorded.'
                : 'Set the time and choose who gets this punch.'}
          </p>

          {canMarkTravel && (
            <label className="flex items-center gap-2 text-sm text-ink mb-4 pb-4 border-b border-line cursor-pointer">
              <input
                type="checkbox"
                checked={markTravel}
                onChange={e => setMarkTravel(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              Mark as Travel Day
            </label>
          )}

          {!markTravel && (
            <div className="flex gap-3">
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
          )}

          {/* Said out loud, because confirm() moves the typed time — see
              TimeEntryModal. */}
          {roundingMinutes > 1 && (
            <p className="-mt-2 mb-4 text-xs text-muted">
              Recorded in {roundingMinutes}-minute steps, always rounded up.
            </p>
          )}
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
            {markTravel ? `Travel Day for ${checked.size}` : `Apply to ${checked.size}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
