'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function OrgSettingsClient({
  organizationId,
  timecardRoundingMinutes,
  finalReportEmails,
}: {
  organizationId: string
  timecardRoundingMinutes: number
  finalReportEmails: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [rounding, setRounding] = useState(timecardRoundingMinutes)
  const [finalEmails, setFinalEmails] = useState(finalReportEmails || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    const { error } = await supabase
      .from('organizations')
      .update({
        timecard_rounding_minutes: rounding,
        final_report_emails: finalEmails.trim() || null,
      })
      .eq('id', organizationId)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="border-t border-line pt-4">

      <div className="mb-4">
        <label className="block text-sm text-muted mb-2">Timecard Rounding</label>
        <Select
          ariaLabel="Timecard rounding"
          value={String(rounding)}
          onChange={v => setRounding(parseInt(v))}
          options={[
            { value: '1', label: 'Exact minute' },
            { value: '15', label: 'Nearest 15 minutes' },
            { value: '30', label: 'Nearest 30 minutes' },
          ]}
        />
        <p className="text-xs text-muted mt-1">Rounds worked time up to the next interval before calculating pay.</p>
      </div>

      {/* "Default CC Email" used to sit here. It predated the Final Report,
          which shipped using final_report_emails below, and was written by this
          form but read by nothing — a setting that looked like it did something
          and didn't. The organizations.default_cc_email column is left in place
          (dropping it is irreversible and it costs nothing) but is now unused. */}

      <div className="mb-4">
        <label className="block text-sm text-muted mb-2">Final Report Recipients</label>
        <input
          type="text"
          value={finalEmails}
          onChange={e => setFinalEmails(e.target.value)}
          placeholder="payroll@example.com, bookkeeper@example.com"
          className={inputCls}
        />
        <p className="text-xs text-muted mt-1">
          Comma-separated. Where a PM&apos;s end-of-show Final Report is sent, complete with
          pay figures. Only admins can change this — a PM never chooses the recipients, and
          never sees the numbers.
        </p>
      </div>

      {error && <p className="text-xs text-danger mb-3">{error}</p>}

      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
      </Button>
    </div>
  )
}
