'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  PUNCH_LABELS,
  PunchType,
  visiblePunchTypes,
  BatchTimecard,
  canApplyBatch,
  isEligibleForBatch,
  planBatchApply,
  BatchPlan,
} from '@/lib/punches'
import { cn } from '@/lib/cn'
import Button from '@/components/ui/Button'
import BatchTimeModal from '@/components/BatchTimeModal'

type Overlay =
  | { kind: 'none' }
  | { kind: 'picker'; type: PunchType; mode: 'apply' | 'change' }
  | { kind: 'override'; type: PunchType }
  | { kind: 'warning'; type: PunchType }
  | { kind: 'summary'; type: PunchType; plan: BatchPlan }

export default function BatchPunchBar({
  timecards,
  dayDate,
  timezone,
  label = 'Batch Actions',
  locked = false,
  gridCols,
  columns,
}: {
  timecards: BatchTimecard[]
  dayDate: string
  timezone: string
  /**
   * Heading above the buttons. The same component drives a room's own bar and
   * the day-level "All Rooms" bar, and those need telling apart — two
   * identically-labelled bars on one screen is a good way to wrap the wrong
   * people. Scope is whatever `timecards` is; this just names it.
   */
  label?: string | null
  /** Show is finalized: batch punching is refused by the database. */
  locked?: boolean
  /**
   * The punch table's grid template, so each batch button sits directly above
   * the column it fills. Alignment is what lets the "Batch Actions" caption go:
   * position explains the buttons better than a label ever did.
   */
  gridCols?: string
  /**
   * The DAY's punch types, not this bar's own. A room where nobody has taken a
   * second break shows fewer punch columns than the day's header does, and a bar
   * that rendered only its own would drift out of alignment with the table
   * underneath it. Columns come from the day; buttons for punches this scope
   * cannot apply are simply inactive, which is the existing behaviour.
   */
  columns?: PunchType[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' })
  const [busy, setBusy] = useState(false)

  function anyHasPunch(type: PunchType): boolean {
    return timecards.some(tc => tc.punches.some(p => p.punch_type === type))
  }

  function onTap(type: PunchType) {
    if (busy) return
    if (canApplyBatch(timecards, type)) {
      setOverlay({ kind: 'picker', type, mode: 'apply' })
    } else if (anyHasPunch(type)) {
      setOverlay({ kind: 'override', type })
    } else {
      setOverlay({ kind: 'warning', type })
    }
  }

  async function applyPicked(type: PunchType, when: Date, checkedIds: Set<string>, markTravel = false) {
    // Travel day is a state, not a punch: flag the checked crew and record no
    // times. Chronology validation doesn't apply, so it bypasses planBatchApply.
    if (markTravel) {
      const ids = [...checkedIds]
      setBusy(true)
      const { error } = await supabase.from('timecards').update({ is_travel_day: true }).in('id', ids)
      setBusy(false)

      const applied = timecards.filter(t => checkedIds.has(t.id)).map(t => ({ id: t.id, name: t.crew_member_name }))
      const skipped = timecards
        .filter(t => !checkedIds.has(t.id))
        .map(t => ({ name: t.crew_member_name, reason: 'Excluded' }))

      setOverlay(
        error
          ? { kind: 'warning', type }
          : { kind: 'summary', type, plan: { applied, skipped } }
      )
      router.refresh()
      return
    }

    const plan = planBatchApply(timecards, type, when, checkedIds)
    setBusy(true)

    for (const a of plan.applied) {
      const tc = timecards.find(t => t.id === a.id)
      const existing = tc?.punches.find(p => p.punch_type === type)
      if (existing) {
        await supabase.from('punches').update({ punched_at: when.toISOString() }).eq('id', existing.id)
      } else {
        await supabase.from('punches').insert({ timecard_id: a.id, punch_type: type, punched_at: when.toISOString() })
      }
    }

    setBusy(false)
    setOverlay({ kind: 'summary', type, plan })
    router.refresh()
  }

  async function clearAll(type: PunchType) {
    if (!confirm(`Clear ${PUNCH_LABELS[type]} from everyone in this room? This cannot be undone.`)) return
    const ids = timecards
      .flatMap(tc => tc.punches.filter(p => p.punch_type === type).map(p => p.id))
    if (ids.length === 0) return

    setBusy(true)
    await supabase.from('punches').delete().in('id', ids)
    setBusy(false)

    const clearedNames = timecards
      .filter(tc => tc.punches.some(p => p.punch_type === type))
      .map(tc => tc.crew_member_name)
    setOverlay({ kind: 'summary', type, plan: { applied: [], skipped: clearedNames.map(name => ({ name, reason: 'Cleared' })) } })
    router.refresh()
  }

  // Same reveal as the punch table: no M3 button until someone has finished a
  // second break. Falls back to this bar's own scope when the day's columns are
  // not supplied.
  const types = columns ?? visiblePunchTypes(timecards.map(tc => tc.punches))

  return (
    <div className="px-4 pt-3 pb-1">
      {label && (
        <p className="text-[10.5px] uppercase tracking-wide text-muted font-bold mb-2">{label}</p>
      )}
      {/* Three across on a phone rather than flex-wrap, which left "Wrap All"
          orphaned on a line of its own, and which matches the 3x2 punch block
          each crew member gets. On desktop the punch table's own template takes
          over so every button lands on its column. */}
      <div className={cn('grid grid-cols-3 gap-1.5', gridCols && `lg:gap-3 ${gridCols}`)}>
        {/* Empty cell under the Crew column, desktop only. */}
        {gridCols && <div className="hidden lg:block" />}
        {types.map(type => {
          const active = canApplyBatch(timecards, type)
          return (
            <button
              key={type}
              onClick={() => onTap(type)}
              disabled={busy || locked}
              title={locked ? 'Times are locked — the final report has been sent.' : undefined}
              className={cn(
                'w-full rounded-field border px-3 py-2 text-xs uppercase transition-colors disabled:opacity-50',
                // `active` marks the punch this bar would apply next. The room's
                // lit key is solid accent (TimecardRow); the batch echo of it is
                // the ghost register — accent ink and edge, wash fill — so the
                // one-person action and the everyone action never look identical.
                // On a locked show the highlight has to go: opacity-50 alone
                // leaves an accent button still reading as the thing to press,
                // which is precisely the "looks live, then fails" behaviour this
                // work exists to remove.
                active && !locked
                  ? 'border-2 border-accent bg-accent-wash font-bold text-accent'
                  : 'border-line bg-surface-2 font-medium text-muted',
                !locked && 'hover:border-accent hover:text-accent',
              )}
            >
              {PUNCH_LABELS[type]} All
            </button>
          )
        })}
        {/* Travel, total and menu columns. */}
        {gridCols && <><div className="hidden lg:block" /><div className="hidden lg:block" /><div className="hidden lg:block" /></>}
      </div>

      {overlay.kind === 'picker' && (
        <BatchTimeModal
          type={overlay.type}
          mode={overlay.mode}
          scope={timecards}
          dayDate={dayDate}
          timezone={timezone}
          onCancel={() => setOverlay({ kind: 'none' })}
          onConfirm={(when, checkedIds, markTravel) => applyPicked(overlay.type, when, checkedIds, markTravel)}
        />
      )}

      {overlay.kind === 'override' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge">
            <h2 className="text-lg font-bold text-ink mb-1">{PUNCH_LABELS[overlay.type]} All</h2>
            <p className="text-xs text-muted mb-5">
              Everyone eligible already has this punch. Update or clear the existing times.
            </p>
            <div className="flex flex-col gap-3">
              <Button
                className="w-full py-3"
                onClick={() => setOverlay({ kind: 'picker', type: overlay.type, mode: 'change' })}
              >
                Change All Times
              </Button>
              <Button variant="danger" className="w-full py-3" onClick={() => clearAll(overlay.type)} disabled={busy}>
                Clear All Times
              </Button>
              <Button variant="ghost" className="w-full py-3" onClick={() => setOverlay({ kind: 'none' })}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {overlay.kind === 'warning' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge">
            <h2 className="text-lg font-bold text-ink mb-1">{PUNCH_LABELS[overlay.type]} All</h2>
            <p className="text-sm text-muted mb-5">This action isn&apos;t available yet.</p>
            <Button className="w-full py-3" onClick={() => setOverlay({ kind: 'none' })}>Got it</Button>
          </div>
        </div>
      )}

      {overlay.kind === 'summary' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-ink mb-4">{PUNCH_LABELS[overlay.type]}</h2>
            {overlay.plan.applied.length === 0 && overlay.plan.skipped.every(s => s.reason !== 'Cleared') && (
              <p className="text-sm text-muted mb-4">No crew were updated.</p>
            )}
            {overlay.plan.applied.length > 0 && (
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wide text-good font-bold mb-1">
                  Applied to {overlay.plan.applied.length}
                </p>
                <p className="text-sm text-ink">{overlay.plan.applied.map(a => a.name).join(', ')}</p>
              </div>
            )}
            {overlay.plan.skipped.length > 0 && (
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wide text-muted font-bold mb-1">
                  {overlay.plan.skipped.every(s => s.reason === 'Cleared') ? 'Cleared from' : 'Skipped'} {overlay.plan.skipped.length}
                </p>
                <ul className="text-sm text-muted space-y-0.5">
                  {overlay.plan.skipped.map((s, i) => (
                    <li key={i}>
                      {s.name}
                      {s.reason !== 'Cleared' && <span className="text-muted/60"> ({s.reason})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button className="w-full py-3" onClick={() => setOverlay({ kind: 'none' })}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}
