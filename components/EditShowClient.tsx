'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Toggle from '@/components/ui/Toggle'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'
const numberInputCls =
  'w-20 rounded-field bg-surface-2 border border-line px-2 py-1.5 text-sm text-ink text-right outline-none focus:border-accent'

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
}: {
  show: any
  ruleset: any
  workDays: any[]
  rooms: any[]
  crewRateEntries: any[]
  shoulderSurferMode?: boolean
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

  const [showSTAInfo, setShowSTAInfo] = useState(false)
  const [showMealInfo, setShowMealInfo] = useState(false)

  const [rateEntry, setRateEntry] = useState<any>(null)
  const [rateText, setRateText] = useState('')

  function updateRuleset(field: string, value: any) {
    setRs((prev: any) => ({ ...prev, [field]: value }))
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
        .update({
          travel_rate: rs.travel_rate,
          overtime_after_hours: rs.overtime_after_hours,
          double_time_enabled: rs.double_time_enabled,
          double_time_after_hours: rs.double_time_after_hours,
          meal_penalty_enabled: rs.meal_penalty_enabled,
          meal_penalty_grace_period: rs.meal_penalty_grace_period,
          meal_penalty_amount: rs.meal_penalty_amount,
          minimum_meal_break_enabled: rs.minimum_meal_break_enabled,
          minimum_meal_break_minutes: rs.minimum_meal_break_minutes,
          meal_break_deduction_cap: rs.meal_break_deduction_cap,
          short_turn_penalty_enabled: rs.short_turn_penalty_enabled,
          short_turn_rest_hours: rs.short_turn_rest_hours,
        })
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

  async function extendShow() {
    const sortedDays = [...workDays].sort((a, b) => a.date.localeCompare(b.date))
    const lastDay = sortedDays[sortedDays.length - 1]
    if (!lastDay) return

    const nextDate = new Date(lastDay.date + 'T00:00:00')
    nextDate.setDate(nextDate.getDate() + 1)
    const nextDateStr = nextDate.toISOString().slice(0, 10)

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
          <Card className="p-5 mb-4">
            <p className="text-xs uppercase tracking-wide text-muted mb-3">Hours &amp; Pay Rates</p>

            <div className="mb-3">
              <label className="text-sm text-ink block mb-1">Travel Day Pay</label>
              <select
                value={rs.travel_rate}
                onChange={e => updateRuleset('travel_rate', e.target.value)}
                className={`${inputCls} py-2`}
              >
                <option value="halfDay" className="bg-surface-2 text-ink">Half Day</option>
                <option value="fullDay" className="bg-surface-2 text-ink">Full Day</option>
              </select>
            </div>

            <FieldRow label="Overtime Starts After">
              <div className="flex items-center gap-2">
                <input
                  type="number" step={0.5} min={0} max={24}
                  value={rs.overtime_after_hours}
                  onChange={e => updateRuleset('overtime_after_hours', parseFloat(e.target.value) || 0)}
                  className={numberInputCls}
                />
                <span className="text-sm text-muted">hrs</span>
              </div>
            </FieldRow>

            <FieldRow label="Enable Double Time">
              <Toggle checked={rs.double_time_enabled} onChange={v => updateRuleset('double_time_enabled', v)} label="Enable Double Time" />
            </FieldRow>

            {rs.double_time_enabled && (
              <FieldRow label="Double Time Starts After">
                <div className="flex items-center gap-2">
                  <input
                    type="number" step={0.5} min={0} max={24}
                    value={rs.double_time_after_hours}
                    onChange={e => updateRuleset('double_time_after_hours', parseFloat(e.target.value) || 0)}
                    className={numberInputCls}
                  />
                  <span className="text-sm text-muted">hrs</span>
                </div>
              </FieldRow>
            )}

            <p className="text-xs text-muted mt-3">Crew are paid their full day rate up to the Overtime threshold. Hours beyond that are paid at 1.5×. Double time (2×) is optional and kicks in after its own threshold.</p>
          </Card>

          <Card className="p-5 mb-4">
            <p className="text-xs uppercase tracking-wide text-muted mb-3">Meal Rules</p>

            <FieldRow label="Meal Penalties">
              <Toggle checked={rs.meal_penalty_enabled} onChange={v => updateRuleset('meal_penalty_enabled', v)} label="Meal Penalties" />
            </FieldRow>

            {rs.meal_penalty_enabled && (
              <>
                <FieldRow label="Grace Period">
                  <div className="flex items-center gap-2">
                    <input
                      type="number" step={0.5} min={0} max={12}
                      value={rs.meal_penalty_grace_period}
                      onChange={e => updateRuleset('meal_penalty_grace_period', parseFloat(e.target.value) || 0)}
                      className={numberInputCls}
                    />
                    <span className="text-sm text-muted">hrs</span>
                  </div>
                </FieldRow>
                {showFinancials && (
                  <FieldRow label="Penalty Amount">
                    <div className="flex items-center gap-2">
                      <input
                        type="number" step={5} min={0} max={500}
                        value={rs.meal_penalty_amount}
                        onChange={e => updateRuleset('meal_penalty_amount', parseFloat(e.target.value) || 0)}
                        className={numberInputCls}
                      />
                      <span className="text-sm text-muted">{rs.meal_penalty_amount > 0 ? '$' : '(OT Rate)'}</span>
                    </div>
                  </FieldRow>
                )}
              </>
            )}

            <FieldRow
              label={<>Working Lunch Rule
                <button onClick={() => setShowMealInfo(true)} className="text-accent">ⓘ</button>
              </>}
            >
              <Toggle checked={rs.minimum_meal_break_enabled} onChange={v => updateRuleset('minimum_meal_break_enabled', v)} label="Working Lunch Rule" />
            </FieldRow>

            {rs.minimum_meal_break_enabled && (
              <>
                <FieldRow label="Minimum Break Length">
                  <div className="flex items-center gap-2">
                    <input
                      type="number" step={15} min={15} max={120}
                      value={rs.minimum_meal_break_minutes}
                      onChange={e => updateRuleset('minimum_meal_break_minutes', parseFloat(e.target.value) || 0)}
                      className={numberInputCls}
                    />
                    <span className="text-sm text-muted">min</span>
                  </div>
                </FieldRow>
                <FieldRow label="Max Deduction Per Break">
                  <div className="flex items-center gap-2">
                    <input
                      type="number" step={15} min={15} max={120}
                      value={rs.meal_break_deduction_cap}
                      onChange={e => updateRuleset('meal_break_deduction_cap', parseFloat(e.target.value) || 0)}
                      className={numberInputCls}
                    />
                    <span className="text-sm text-muted">min</span>
                  </div>
                </FieldRow>
              </>
            )}

            <p className="text-xs text-muted mt-3">Meal penalties are charged when crew go too long without a break. The working lunch rule controls whether short breaks count as paid work time.</p>
          </Card>

          <Card className="p-5 mb-4">
            <p className="text-xs uppercase tracking-wide text-muted mb-3">Turnaround</p>

            <FieldRow
              label={<>Short Turnaround Penalty
                <button onClick={() => setShowSTAInfo(true)} className="text-accent">ⓘ</button>
              </>}
            >
              <Toggle checked={rs.short_turn_penalty_enabled} onChange={v => updateRuleset('short_turn_penalty_enabled', v)} label="Short Turnaround Penalty" />
            </FieldRow>

            {rs.short_turn_penalty_enabled && (
              <FieldRow label="Minimum Rest Between Shifts">
                <div className="flex items-center gap-2">
                  <input
                    type="number" step={0.5} min={0} max={24}
                    value={rs.short_turn_rest_hours}
                    onChange={e => updateRuleset('short_turn_rest_hours', parseFloat(e.target.value) || 0)}
                    className={numberInputCls}
                  />
                  <span className="text-sm text-muted">hrs</span>
                </div>
              </FieldRow>
            )}

            <p className="text-xs text-muted mt-3">A short turnaround (forced call) occurs when a crew member doesn&apos;t get enough rest between shifts. Their entire next day is paid at double time.</p>
          </Card>
        </>
      )}

      {showSTAInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowSTAInfo(false)}>
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-ink mb-3">Short Turnaround</h2>
            <p className="text-sm text-ink mb-4 whitespace-pre-line">
              Also called a &apos;Forced Call.&apos; If a crew member gets less than the minimum rest between shifts, their entire next day is paid at double time.
              {'\n\n'}
              Example: Crew wraps at midnight and is called at 8am — only 8 hours rest. With a 10-hour minimum, that entire next day starts at double time.
            </p>
            <Button className="w-full py-3" onClick={() => setShowSTAInfo(false)}>Got it</Button>
          </div>
        </div>
      )}

      {showMealInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowMealInfo(false)}>
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-ink mb-3">Working Lunch Rule</h2>
            <p className="text-sm text-ink mb-4 whitespace-pre-line">
              When enabled, breaks shorter than the minimum length are treated as working lunches — no time is deducted from hours worked.
              {'\n\n'}
              Breaks at or beyond the minimum have up to the &apos;Max Deduction&apos; amount subtracted. Crew are paid for any hold time beyond that cap.
              {'\n\n'}
              Example with 60-min minimum and 60-min cap: A 45-min break = no deduction. A 90-min break = 60 min deducted, 30 min paid.
            </p>
            <Button className="w-full py-3" onClick={() => setShowMealInfo(false)}>Got it</Button>
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
