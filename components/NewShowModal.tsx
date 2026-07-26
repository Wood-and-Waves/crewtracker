'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/datetime'
import { pickRulesetValues, type RulesetValues } from '@/lib/ruleset'
import Button from '@/components/ui/Button'

type Preset = { id: string; name: string; is_default: boolean } & RulesetValues

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
    // Read the LOCAL calendar date — `cur` is local midnight, so toISOString()
    // would report the UTC date and shift every work day back a day for any
    // browser ahead of UTC.
    dates.push(localDateStr(cur))
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

  // Payroll presets: picking one COPIES its rules into this show's ruleset.
  // '' means "Custom" — start from the plain column defaults, the old behaviour.
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetId, setPresetId] = useState('')

  useEffect(() => {
    if (!open) return
    supabase
      .from('payroll_presets')
      .select('*')
      .eq('organization_id', organizationId)
      .order('sort_order')
      .then(({ data }) => {
        const list = (data || []) as Preset[]
        setPresets(list)
        // Pre-select the org's default preset, if it has one.
        setPresetId(list.find(p => p.is_default)?.id ?? '')
      })
  }, [open, organizationId])

  const chosen = presets.find(p => p.id === presetId) || null

  function summarize(p: Preset): string {
    const bits = [`OT after ${p.overtime_after_hours}h`]
    if (p.double_time_enabled) bits.push(`DT after ${p.double_time_after_hours}h`)
    if (p.continuous_time_enabled) bits.push('continuous time')
    if (p.meal_penalty_enabled) bits.push('meal penalties')
    if (p.short_turn_penalty_enabled) bits.push(`turnaround ${p.short_turn_rest_hours}h`)
    return bits.join(' · ')
  }

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

    // Copy the preset's values in rather than referencing it. The show owns its
    // rules from here on, so editing or deleting the preset later can never
    // rewrite the hours and pay on a show that already exists.
    const rulesetRow = chosen
      ? { show_id: show.id, ...pickRulesetValues(chosen) }
      : { show_id: show.id }

    const [rulesetResult, daysResult] = await Promise.all([
      supabase.from('payroll_rulesets').insert(rulesetRow),
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

          <div>
            <label className="text-xs uppercase tracking-wide text-muted block mb-1">Payroll Rules</label>
            <select
              key={presets.map(p => p.id).join(',')}
              value={presetId}
              onChange={e => setPresetId(e.target.value)}
              className={inputCls}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id} className="bg-surface-2 text-ink">
                  {p.name}{p.is_default ? ' (default)' : ''}
                </option>
              ))}
              <option value="" className="bg-surface-2 text-ink">Custom — start from scratch</option>
            </select>
            <p className="text-xs text-muted mt-1">
              {chosen
                ? summarize(chosen)
                : 'OT after 10h, no double time, no meal penalties, no short turnaround. Set them per-show in Edit Show.'}
            </p>
          </div>

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
