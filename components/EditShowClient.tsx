'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/datetime'
import { applyRulesetChange, pickRulesetValues } from '@/lib/ruleset'
import RulesetFields from '@/components/RulesetFields'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Toggle from '@/components/ui/Toggle'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

function FieldRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 last:mb-0">
      <span className="text-sm text-ink flex items-center gap-1.5">{label}</span>
      {children}
    </div>
  )
}

export default function EditShowClient({
  show,
  ruleset,
  workDays,
  rooms,
  crewRateEntries,
  shoulderSurferMode = false,
  organizationId,
  canManageRulesets = false,
}: {
  show: any
  ruleset: any
  workDays: any[]
  rooms: any[]
  crewRateEntries: any[]
  shoulderSurferMode?: boolean
  organizationId?: string
  canManageRulesets?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [name, setName] = useState(show.name)
  const [venue, setVenue] = useState(show.venue || '')
  const [clientCompany, setClientCompany] = useState(show.client_company || '')
  const [jobNumber, setJobNumber] = useState(show.job_number || '')
  const [showNotes, setShowNotes] = useState(show.show_notes || '')
  const [showFinancials, setShowFinancials] = useState(show.show_financials || false)
  const [timezone, setTimezone] = useState(show.timezone_identifier)

  const [rs, setRs] = useState(ruleset)

  const [rateEntry, setRateEntry] = useState<any>(null)
  const [rateText, setRateText] = useState('')

  // "Save as preset" — captures this show's tuned rules as a reusable template.
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetError, setPresetError] = useState('')
  const [presetSaved, setPresetSaved] = useState('')

  function updateRuleset(field: string, value: any) {
    setRs((prev: any) => applyRulesetChange(prev, field, value))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')

    const showResult = await supabase
      .from('shows')
      .update({
        name,
        venue,
        client_company: clientCompany,
        job_number: jobNumber,
        show_notes: showNotes,
        show_financials: showFinancials,
        timezone_identifier: timezone,
      })
      .eq('id', show.id)

    if (showResult.error) {
      setSaving(false)
      setSaveError(showResult.error.message)
      return
    }

    if (rs) {
      const rulesetResult = await supabase
        .from('payroll_rulesets')
        .update(pickRulesetValues(rs))
        .eq('show_id', show.id)

      if (rulesetResult.error) {
        setSaving(false)
        setSaveError(rulesetResult.error.message)
        return
      }
    }

    setSaving(false)
    router.push(`/dashboard/shows/${show.id}`)
  }

  async function saveAsPreset() {
    const trimmed = presetName.trim()
    if (!trimmed || !organizationId || !rs) return
    setPresetBusy(true)
    setPresetError('')

    const { error } = await supabase
      .from('payroll_presets')
      .insert({ organization_id: organizationId, name: trimmed, ...pickRulesetValues(rs) })

    setPresetBusy(false)

    if (error) {
      // The (organization_id, lower(name)) unique index surfaces here.
      setPresetError(
        error.code === '23505'
          ? `A preset named "${trimmed}" already exists.`
          : error.message
      )
      return
    }

    setPresetOpen(false)
    setPresetName('')
    setPresetSaved(trimmed)
    router.refresh()
  }

  async function extendShow() {
    const sortedDays = [...workDays].sort((a, b) => a.date.localeCompare(b.date))
    const lastDay = sortedDays[sortedDays.length - 1]
    if (!lastDay) return

    const nextDate = new Date(lastDay.date + 'T00:00:00')
    nextDate.setDate(nextDate.getDate() + 1)
    // Local calendar date, not the UTC one — see localDateStr.
    const nextDateStr = localDateStr(nextDate)

    if (nextDateStr > show.end_date) {
      await supabase.from('shows').update({ end_date: nextDateStr }).eq('id', show.id)
    }

    const { data: newDay } = await supabase
      .from('work_days')
      .insert({ show_id: show.id, date: nextDateStr, day_number: lastDay.day_number + 1 })
      .select()
      .single()
    if (!newDay) return

    const lastDayRooms = rooms.filter(r => r.work_day_id === lastDay.id)
    const newRoomRows = lastDayRooms.map(r => ({ work_day_id: newDay.id, name: r.name }))
    const { data: newRooms } = newRoomRows.length > 0
      ? await supabase.from('rooms').insert(newRoomRows).select()
      : { data: [] }

    const hasCrew = crewRateEntries.length > 0
    if (hasCrew && newRooms && confirm('Do you want to copy the crew roster from the previous day into this new day?')) {
      const { data: oldTimecards } = await supabase
        .from('timecards')
        .select('*')
        .in('room_id', lastDayRooms.map(r => r.id))

      const newTimecardRows: any[] = []
      for (const oldTc of oldTimecards || []) {
        const oldRoom = lastDayRooms.find(r => r.id === oldTc.room_id)
        const matchingNewRoom = newRooms.find((nr: any) => nr.name === oldRoom?.name)
        if (matchingNewRoom) {
          newTimecardRows.push({
            room_id: matchingNewRoom.id,
            crew_member_id: oldTc.crew_member_id,
            crew_member_name: oldTc.crew_member_name,
            role: oldTc.role,
            day_rate: oldTc.day_rate,
          })
        }
      }
      if (newTimecardRows.length > 0) {
        await supabase.from('timecards').insert(newTimecardRows)
      }
    }

    router.refresh()
  }

  async function commitRateEdit() {
    if (!rateEntry) return
    const newRate = parseFloat(rateText)
    if (isNaN(newRate) || newRate < 0 || newRate === rateEntry.dayRate) {
      setRateEntry(null)
      setRateText('')
      return
    }

    const showRoomIds = rooms.map(r => r.id)
    let query = supabase.from('timecards').update({ day_rate: newRate }).in('room_id', showRoomIds).eq('role', rateEntry.role)
    if (rateEntry.crewMemberId) {
      query = query.eq('crew_member_id', rateEntry.crewMemberId)
    } else {
      query = query.eq('crew_member_name', rateEntry.name)
    }
    await query

    if (rateEntry.crewMemberId && confirm(`Update ${rateEntry.name}'s ${rateEntry.role} rate in the crew directory to $${Math.round(newRate)}?`)) {
      const { data: existingCard } = await supabase
        .from('rate_cards')
        .select('*')
        .eq('crew_member_id', rateEntry.crewMemberId)
        .eq('role', rateEntry.role)
        .maybeSingle()

      if (existingCard) {
        await supabase.from('rate_cards').update({ day_rate: newRate }).eq('id', existingCard.id)
      } else {
        await supabase.from('rate_cards').insert({ crew_member_id: rateEntry.crewMemberId, role: rateEntry.role, day_rate: newRate })
      }
    }

    setRateEntry(null)
    setRateText('')
    router.refresh()
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl pb-32">
      <div className="flex items-center justify-between">
        <Link href={`/dashboard/shows/${show.id}`} className="text-sm text-muted hover:text-ink">← Back to Show</Link>
        <Button onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight mt-2 mb-6">Edit Show Details</h1>

      {saveError && (
        <div className="rounded-field bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger mb-4">
          Save failed: {saveError}
        </div>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-3">Show Name (Required)</p>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
        </Card>

        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-3">Show Dates</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">
              {new Date(show.start_date + 'T00:00:00').toLocaleDateString()} – {new Date(show.end_date + 'T00:00:00').toLocaleDateString()}
            </span>
            <Button variant="ghost" size="sm" onClick={extendShow}>+ Add Day</Button>
          </div>
          <p className="text-xs text-muted mt-2">Adding a day happens immediately — it isn&apos;t part of the Save button above.</p>
        </Card>

        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-1">Show Timezone</p>
          <select
            key={timezone}
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
            className={`${inputCls} mt-2`}
          >
            <option value="America/New_York" className="bg-surface-2 text-ink">Eastern (ET)</option>
            <option value="America/Chicago" className="bg-surface-2 text-ink">Central (CT)</option>
            <option value="America/Denver" className="bg-surface-2 text-ink">Mountain (MT)</option>
            <option value="America/Los_Angeles" className="bg-surface-2 text-ink">Pacific (PT)</option>
            <option value="America/Anchorage" className="bg-surface-2 text-ink">Alaska (AKT)</option>
            <option value="Pacific/Honolulu" className="bg-surface-2 text-ink">Hawaii (HIT)</option>
          </select>
          <p className="text-xs text-muted mt-2">Punch times, the day picker, and reports all use this timezone — useful when you&apos;re prepping a show that&apos;s in a different timezone than you are.</p>
        </Card>

        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-3">Admin &amp; Billing (Optional)</p>
          <input
            placeholder="Client / Production Company"
            value={clientCompany}
            onChange={e => setClientCompany(e.target.value)}
            className={`${inputCls} mb-3`}
          />
          <input
            placeholder="Job / PO Number"
            value={jobNumber}
            onChange={e => setJobNumber(e.target.value)}
            className={inputCls}
          />
        </Card>

        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-3">Location &amp; Venue (Optional)</p>
          <input
            placeholder="Venue Name (e.g. McCormick Place)"
            value={venue}
            onChange={e => setVenue(e.target.value)}
            className={inputCls}
          />
        </Card>

        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-3">General Notes</p>
          <textarea
            placeholder="Logistics, parking info, etc..."
            value={showNotes}
            onChange={e => setShowNotes(e.target.value)}
            rows={4}
            className={inputCls}
          />
        </Card>
      </div>

      <Card className="p-5 mb-4">
        <p className="text-xs uppercase tracking-wide text-muted mb-3">Rates &amp; Payroll Calculation</p>
        <FieldRow label="Show Dollar Amounts">
          <Toggle checked={showFinancials} onChange={setShowFinancials} label="Show Dollar Amounts" />
        </FieldRow>
        <p className="text-xs text-muted mt-2">Turn this on to enter crew day rates and show dollar totals in reports.</p>
      </Card>

      {showFinancials && (
        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-3">Crew &amp; Rates</p>
          {crewRateEntries.length === 0 ? (
            <p className="text-sm text-muted">No crew assigned yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {crewRateEntries.map((entry: any) => (
                <button
                  key={entry.name + entry.role}
                  onClick={() => { setRateEntry(entry); setRateText(String(Math.round(entry.dayRate))) }}
                  className="flex items-center justify-between rounded-field bg-surface-2 px-4 py-3 hover:bg-line/40"
                >
                  <div className="text-left">
                    <p className="text-sm font-semibold text-ink">{entry.name}</p>
                    <p className="text-xs text-muted">{entry.role}</p>
                  </div>
                  <span className="text-sm font-semibold text-accent">
                    {shoulderSurferMode ? '•••' : `$${Math.round(entry.dayRate)}`}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted mt-3">Tap a rate to update it — this saves immediately, separate from the Save button above. Changes apply to all of that person&apos;s timecards on this show for that role.</p>
        </Card>
      )}

      {rs && (
        <>
          <RulesetFields values={rs} onChange={updateRuleset} showFinancials={showFinancials} />

          {canManageRulesets && organizationId && (
            <Card className="p-5 mb-4">
              <p className="text-xs uppercase tracking-wide text-muted mb-3">Reuse These Rules</p>
              {presetSaved ? (
                <p className="text-sm text-good">Saved as &ldquo;{presetSaved}&rdquo; — it&apos;s now available when creating a show.</p>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => { setPresetOpen(true); setPresetError('') }}>
                    Save these rules as a preset…
                  </Button>
                  <p className="text-xs text-muted mt-2">Captures the rules above as a named template you can pick when creating a future show. Saving a preset never changes this or any other existing show.</p>
                </>
              )}
            </Card>
          )}
        </>
      )}

      {presetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-1">Save as Preset</h2>
            <p className="text-sm text-muted mb-4">Name this rule set — e.g. a client or contract it applies to.</p>
            <input
              autoFocus
              placeholder="e.g. Corporate Standard"
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveAsPreset()}
              className={`${inputCls} mb-3`}
            />
            {presetError && <p className="text-xs text-danger mb-3">{presetError}</p>}
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1 py-3" onClick={() => { setPresetOpen(false); setPresetName(''); setPresetError('') }}>
                Cancel
              </Button>
              <Button className="flex-1 py-3" onClick={saveAsPreset} disabled={presetBusy || !presetName.trim()}>
                {presetBusy ? 'Saving…' : 'Save Preset'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {rateEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-1">Edit Day Rate</h2>
            <p className="text-sm text-muted mb-4">New day rate for {rateEntry.name} ({rateEntry.role})</p>
            <input
              type="number"
              value={rateText}
              onChange={e => setRateText(e.target.value)}
              className={`${inputCls} mb-4`}
            />
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1 py-3" onClick={() => { setRateEntry(null); setRateText('') }}>Cancel</Button>
              <Button className="flex-1 py-3" onClick={commitRateEdit}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Floating save affordance for this long form. Sits clear of the
          app's fixed bottom tab-bar (<1024px) instead of overlapping it. */}
      <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-40">
        <Button onClick={handleSave} disabled={saving || !name.trim()} className="rounded-pill px-8 py-3 shadow-xl">
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
