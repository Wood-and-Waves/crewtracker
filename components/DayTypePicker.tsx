'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DAY_TYPES, DAY_TYPE_LABELS, isDayType, type DayType } from '@/lib/dayTypes'
import { cn } from '@/lib/cn'

// What this day of the show is — travel, load-in, rehearsal, show, load-out.
//
// Deliberately NOT gated on a finalized show. That lock covers timecards and
// punches, which is payroll data; it does not cover work days, and room rename
// and Add Day are left enabled for the same reason. Disabling this would
// misrepresent what the lock protects.
//
// Nothing here touches pay. See lib/dayTypes.ts.

export default function DayTypePicker({
  workDayId,
  value,
  className,
}: {
  workDayId: string
  value: string | null
  className?: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(next: string) {
    setError('')
    setSaving(true)
    const dayType: DayType | null = isDayType(next) ? next : null

    // .select('id') and count the rows, rather than trusting the absence of an
    // error. work_days had no UPDATE policy until migration 0015: an UPDATE
    // matching no policy affects ZERO ROWS AND RETURNS SUCCESS, so a missing or
    // wrong policy would look exactly like a save that worked until the next
    // page load. Migration 0007's header records this project already shipping
    // that bug on this table. Never render success we have not confirmed.
    const { data, error: updateError } = await supabase
      .from('work_days')
      .update({ day_type: dayType })
      .eq('id', workDayId)
      .select('id')

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }
    if (!data || data.length === 0) {
      setError("Couldn't save — you may not have permission to change this show.")
      return
    }
    router.refresh()
  }

  return (
    <div className={className}>
      <select
        aria-label="Day type"
        value={isDayType(value) ? value : ''}
        disabled={saving}
        onChange={e => save(e.target.value)}
        className={cn(
          'w-full rounded-field border border-line bg-surface-2 px-2 py-1 text-xs text-ink',
          'outline-none focus:border-accent disabled:opacity-50',
          error && 'border-danger',
        )}
      >
        <option value="" className="bg-surface-2 text-ink">Set day type…</option>
        {DAY_TYPES.map(t => (
          <option key={t} value={t} className="bg-surface-2 text-ink">
            {DAY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  )
}
