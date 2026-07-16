'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  PUNCH_ORDER,
  PUNCH_LABELS,
  PunchType,
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
}: {
  timecards: BatchTimecard[]
  dayDate: string
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

  async function applyPicked(type: PunchType, when: Date, checkedIds: Set<string>) {
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

  return (
    <div className="px-4 pt-3 pb-1">
      <p className="text-[10.5px] uppercase tracking-wide text-muted font-bold mb-2">Batch Actions</p>
      <div className="flex flex-wrap gap-1.5">
        {PUNCH_ORDER.map(type => {
          const active = canApplyBatch(timecards, type)
          return (
            <button
              key={type}
              onClick={() => onTap(type)}
              disabled={busy}
              className={cn(
                'rounded-field border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50',
                active
                  ? 'bg-accent/30 border-transparent text-accent font-semibold'
                  : 'bg-surface-3 border-line text-muted hover:border-accent hover:text-accent',
              )}
            >
              {PUNCH_LABELS[type]} All
            </button>
          )
        })}
      </div>

      {overlay.kind === 'picker' && (
        <BatchTimeModal
          type={overlay.type}
          mode={overlay.mode}
          scope={timecards}
          dayDate={dayDate}
          onCancel={() => setOverlay({ kind: 'none' })}
          onConfirm={(when, checkedIds) => applyPicked(overlay.type, when, checkedIds)}
        />
      )}

      {overlay.kind === 'override' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
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
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-1">{PUNCH_LABELS[overlay.type]} All</h2>
            <p className="text-sm text-muted mb-5">This action isn&apos;t available yet.</p>
            <Button className="w-full py-3" onClick={() => setOverlay({ kind: 'none' })}>Got it</Button>
          </div>
        </div>
      )}

      {overlay.kind === 'summary' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl max-h-[85vh] overflow-y-auto">
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
