'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
    <div className="rounded-2xl bg-zinc-900 p-5 mb-6">
      <h2 className="text-lg font-bold text-white mb-1">Organization Settings</h2>
      <p className="text-xs text-zinc-500 mb-4">Applies to everyone in your organization.</p>

      <div className="mb-4">
        <label className="block text-sm text-zinc-400 mb-2">Timecard Rounding</label>
        <select
          value={rounding}
          onChange={e => setRounding(parseInt(e.target.value))}
          className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={1} className="bg-zinc-800 text-white">Exact minute</option>
          <option value={15} className="bg-zinc-800 text-white">Nearest 15 minutes</option>
          <option value={30} className="bg-zinc-800 text-white">Nearest 30 minutes</option>
        </select>
        <p className="text-xs text-zinc-500 mt-1">Rounds worked time up to the next interval before calculating pay.</p>
      </div>

      <div className="mb-4">
        <label className="block text-sm text-zinc-400 mb-2">Default CC Email</label>
        <input
          type="email"
          value={ccEmail}
          onChange={e => setCcEmail(e.target.value)}
          placeholder="payroll@example.com"
          className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-zinc-500 mt-1">Used as a default CC when report email delivery is built.</p>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
      </button>
    </div>
  )
}
