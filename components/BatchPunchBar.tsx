'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PUNCH_ORDER, PUNCH_LABELS, isWrapped, Punch } from '@/lib/punches'

export default function BatchPunchBar({
  timecards,
}: {
  timecards: { id: string; crew_member_name: string; punches: Punch[] }[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ applied: string[]; skipped: string[] } | null>(null)

  async function batchPunch(type: string) {
    setLoading(type)
    setSummary(null)

    const applied: string[] = []
    const skipped: string[] = []
    const rows: any[] = []
    const now = new Date().toISOString()

    for (const tc of timecards) {
      if (isWrapped(tc.punches)) {
        skipped.push(tc.crew_member_name)
        continue
      }
      const already = tc.punches.some(p => p.punch_type === type)
      if (already) {
        skipped.push(tc.crew_member_name)
        continue
      }
      rows.push({ timecard_id: tc.id, punch_type: type, punched_at: now })
      applied.push(tc.crew_member_name)
    }

    if (rows.length > 0) {
      await supabase.from('punches').insert(rows)
    }

    setLoading(null)
    setSummary({ applied, skipped })
    router.refresh()
  }

  return (
    <div className="px-4 pt-3 pb-1">
      <p className="text-[10.5px] uppercase tracking-wide text-muted font-bold mb-2">Batch Actions</p>
      <div className="flex flex-wrap gap-1.5">
        {PUNCH_ORDER.map(type => (
          <button
            key={type}
            onClick={() => batchPunch(type)}
            disabled={loading !== null}
            className="rounded-field bg-surface-2 border border-line px-3 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {loading === type ? '...' : `${PUNCH_LABELS[type as keyof typeof PUNCH_LABELS]} All`}
          </button>
        ))}
      </div>
      {summary && (
        <p className="mt-2 text-xs text-muted">
          Applied to {summary.applied.length || 'none'}{summary.skipped.length > 0 && `, skipped ${summary.skipped.length} (already punched or wrapped)`}
        </p>
      )}
    </div>
  )
}
