'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
]

export default function NewShowModal({ organizationId }: { organizationId: string }) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [timezone, setTimezone] = useState('America/Chicago')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createShow() {
    setError('')
    setLoading(true)

    const { data: show, error: showError } = await supabase
      .from('shows')
      .insert({
        organization_id: organizationId,
        name,
        venue: venue || null,
        start_date: startDate,
        end_date: endDate,
        timezone_identifier: timezone,
      })
      .select()
      .single()

    if (showError || !show) {
      setError(showError?.message || 'Failed to create show')
      setLoading(false)
      return
    }

    const { error: rulesetError } = await supabase
      .from('payroll_rulesets')
      .insert({ show_id: show.id })

    if (rulesetError) {
      setError(rulesetError.message)
      setLoading(false)
      return
    }

    setLoading(false)
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
      >
        + New Show
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-6 shadow-xl">
        <h2 className="text-xl font-bold text-white mb-4">New Show</h2>

        <div className="flex flex-col gap-3">
          <input
            placeholder="Show name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            placeholder="Venue (optional)"
            value={venue}
            onChange={e => setVenue(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-3">
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 mt-2">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 rounded-lg border border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-500"
            >
              Cancel
            </button>
            <button
              onClick={createShow}
              disabled={loading || !name || !startDate || !endDate}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Show'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
