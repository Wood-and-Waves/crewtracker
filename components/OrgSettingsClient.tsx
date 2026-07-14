'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function OrgSettingsClient({
  organizationId,
  timecardRoundingMinutes,
  defaultCcEmail,
}: {
  organizationId: string
  timecardRoundingMinutes: number
  defaultCcEmail: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [rounding, setRounding] = useState(timecardRoundingMinutes)
  const [ccEmail, setCcEmail] = useState(defaultCcEmail || '')
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
        default_cc_email: ccEmail.trim() || null,
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
    <Card className="p-5">
      <h2 className="text-lg font-bold text-ink mb-1">Organization Settings</h2>
      <p className="text-xs text-muted mb-4">Applies to everyone in your organization.</p>

      <div className="mb-4">
        <label className="block text-sm text-muted mb-2">Timecard Rounding</label>
        <select
          value={rounding}
          onChange={e => setRounding(parseInt(e.target.value))}
          className={inputCls}
        >
          <option value={1} className="bg-surface-2 text-ink">Exact minute</option>
          <option value={15} className="bg-surface-2 text-ink">Nearest 15 minutes</option>
          <option value={30} className="bg-surface-2 text-ink">Nearest 30 minutes</option>
        </select>
        <p className="text-xs text-muted mt-1">Rounds worked time up to the next interval before calculating pay.</p>
      </div>

      <div className="mb-4">
        <label className="block text-sm text-muted mb-2">Default CC Email</label>
        <input
          type="email"
          value={ccEmail}
          onChange={e => setCcEmail(e.target.value)}
          placeholder="payroll@example.com"
          className={inputCls}
        />
        <p className="text-xs text-muted mt-1">Used as a default CC when report email delivery is built.</p>
      </div>

      {error && <p className="text-xs text-danger mb-3">{error}</p>}

      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
      </Button>
    </Card>
  )
}
