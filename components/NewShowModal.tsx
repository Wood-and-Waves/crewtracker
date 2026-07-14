'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
]

function datesBetween(start: string, end: string) {
  const dates: string[] = []
  const cur = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

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

    const dates = datesBetween(startDate, endDate)
    const workDayRows = dates.map((date, i) => ({
      show_id: show.id,
      date,
      day_number: i + 1,
    }))

    const [rulesetResult, daysResult] = await Promise.all([
      supabase.from('payroll_rulesets').insert({ show_id: show.id }),
      supabase.from('work_days').insert(workDayRows),
    ])

    if (rulesetResult.error) {
      setError(rulesetResult.error.message)
      setLoading(false)
      return
    }
    if (daysResult.error) {
      setError(daysResult.error.message)
      setLoading(false)
      return
    }

    setLoading(false)
    setOpen(false)
    router.push(`/dashboard/shows/${show.id}`)
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ New Show</Button>
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-card bg-surface border border-line p-6 shadow-xl">
        <h2 className="text-xl font-bold text-ink mb-4">New Show</h2>

        <div className="flex flex-col gap-3">
          <input
            placeholder="Show name"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputCls}
          />
          <input
            placeholder="Venue (optional)"
            value={venue}
            onChange={e => setVenue(e.target.value)}
            className={inputCls}
          />
          <div className="flex gap-3">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
          </div>
          <select
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
            className={inputCls}
          >
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value} className="bg-surface-2 text-ink">{tz.label}</option>
            ))}
          </select>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1 py-3" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              className="flex-1 py-3"
              onClick={createShow}
              disabled={loading || !name || !startDate || !endDate}
            >
              {loading ? 'Creating...' : 'Create Show'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
