'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { applyRulesetChange, pickRulesetValues } from '@/lib/ruleset'
import { SHOW_TIMEZONES } from '@/lib/timezones'
import RulesetFields from '@/components/RulesetFields'
import AddDayButton from '@/components/AddDayButton'
import DayTypePicker from '@/components/DayTypePicker'
import HandoffToSchedulerButton from '@/components/HandoffToSchedulerButton'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import Toggle from '@/components/ui/Toggle'
import { dayTypeBgClass } from '@/lib/dayTypes'
import { cn } from '@/lib/cn'

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
  canViewRates = false,
  canEditRates = false,
  scheduling,
  children,
}: {
  show: any
  ruleset: any
  workDays: any[]
  rooms: any[]
  crewRateEntries: any[]
  /** Handoff state, fetched server-side. Omitted for a caller who shouldn't
   *  see the Scheduling section at all. */
  scheduling?: { schedulerName: string | null; positionCount: number; callSize: string }
  shoulderSurferMode?: boolean
  organizationId?: string
  canManageRulesets?: boolean
  /** profiles.can_view_pay_rates — may this user see day rates at all? */
  canViewRates?: boolean
  /** profiles.can_edit_pay_rates — may they change them? */
  canEditRates?: boolean
  /** Server-rendered sections appended below the form (e.g. Show Access), so
   *  their data fetching stays on the server instead of being threaded through
   *  this client component as props. */
  children?: React.ReactNode
}) {
  const router = useRouter()
  const supabase = createClient()
  const [saveError, setSaveError] = useState('')
  // Transient "Saved" tick. Deliberately not a toast: this page fires a lot of
  // small writes and a stack of toasts would be worse than the Save button was.
  const [savedTick, setSavedTick] = useState(0)

  const [name, setName] = useState(show.name)
  const [venue, setVenue] = useState(show.venue || '')
  const [cityState, setCityState] = useState(show.city_state || '')
  const [clientCompany, setClientCompany] = useState(show.client_company || '')
  const [jobNumber, setJobNumber] = useState(show.job_number || '')
  const [showNotes, setShowNotes] = useState(show.show_notes || '')
  const [showFinancials, setShowFinancials] = useState(show.show_financials || false)
  const [timezone, setTimezone] = useState(show.timezone_identifier)

  const [rs, setRs] = useState(ruleset)

  const [rateEntry, setRateEntry] = useState<any>(null)
  const [rateText, setRateText] = useState('')
  // "Also update their saved rate in the Crew Directory." This used to be a
  // browser confirm() fired AFTER the show rate had already been written, which
  // read as a redundant "are you sure" when it is actually a separate question
  // about a different record. Asked here instead, before saving, so one Save
  // does everything.
  //
  // Defaults OFF: a rate negotiated for one show is not automatically that
  // person's standing rate, and silently rewriting their directory default
  // would follow them onto every future show.
  const [alsoSaveToDirectory, setAlsoSaveToDirectory] = useState(false)
  const [rateError, setRateError] = useState('')

  // "Save as preset" — captures this show's tuned rules as a reusable template.
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetError, setPresetError] = useState('')
  const [presetSaved, setPresetSaved] = useState('')

  // ---------------------------------------------------------------------
  // AUTOSAVE. There is no Save button on this page.
  //
  // Half of it never had one — Add Day, the crew rate editor and day types all
  // wrote immediately — so the button only ever covered the other half, and a
  // page where some controls commit instantly and others wait for a pill at the
  // bottom is a page that loses work. Text fields save on blur, switches and
  // pickers on change, and the payroll rules on a short debounce because number
  // inputs fire per keystroke.
  // ---------------------------------------------------------------------

  function noteSaved() {
    setSaveError('')
    setSavedTick(t => t + 1)
  }

  /**
   * One verified write to `shows`.
   *
   * `.select('id')` and a row count, never the absence of an error: an UPDATE
   * that matches no RLS policy affects ZERO ROWS AND RETURNS SUCCESS, which
   * looks exactly like a save that worked until the next page load. This
   * project has shipped that bug before (migration 0007's header, and again on
   * work_days in 0015).
   */
  async function saveShow(patch: Record<string, any>) {
    const { data, error } = await supabase
      .from('shows')
      .update(patch)
      .eq('id', show.id)
      .select('id')

    if (error) { setSaveError(error.message); return false }
    if (!data || data.length === 0) {
      setSaveError("Couldn't save — you may not have permission to edit this show.")
      return false
    }
    noteSaved()
    router.refresh()
    return true
  }

  /** Save a text field on blur, skipping the write when nothing changed. */
  function saveTextField(column: string, value: string, original: string | null) {
    const next = value.trim()
    if (next === (original ?? '').trim()) return
    saveShow({ [column]: next || null })
  }

  // Payroll rules: apply locally at once, write on a trailing debounce. A
  // single shared timer, so dragging a threshold from 10 to 14 is one write.
  const rulesetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRuleset = useRef<any>(null)

  async function flushRuleset() {
    const values = pendingRuleset.current
    if (!values) return
    pendingRuleset.current = null
    const { data, error } = await supabase
      .from('payroll_rulesets')
      .update(values)
      .eq('show_id', show.id)
      .select('id')

    if (error) { setSaveError(error.message); return }
    if (!data || data.length === 0) {
      setSaveError("Couldn't save the payroll rules — you may not have permission.")
      return
    }
    noteSaved()
  }

  function updateRuleset(field: string, value: any) {
    setRs((prev: any) => {
      const next = applyRulesetChange(prev, field, value)
      // Queue the WHOLE ruleset rather than the single field: the mutual
      // exclusion in applyRulesetChange can turn a second field off, and that
      // consequence has to reach the database too.
      pendingRuleset.current = pickRulesetValues(next)
      return next
    })
    if (rulesetTimer.current) clearTimeout(rulesetTimer.current)
    rulesetTimer.current = setTimeout(flushRuleset, 600)
  }

  // Leaving the page mid-debounce must not drop the last edit.
  useEffect(() => {
    return () => {
      if (rulesetTimer.current) clearTimeout(rulesetTimer.current)
      void flushRuleset()
    }
  }, [])

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

  async function commitRateEdit() {
    if (!rateEntry) return
    const newRate = parseFloat(rateText)
    if (isNaN(newRate) || newRate < 0) {
      setRateError('Enter a day rate of 0 or more.')
      return
    }
    if (newRate === rateEntry.dayRate) {
      closeRateEditor()
      return
    }

    const showRoomIds = rooms.map(r => r.id)
    let query = supabase
      .from('timecards')
      .update({ day_rate: newRate })
      .in('room_id', showRoomIds)
      .eq('role', rateEntry.role)
    if (rateEntry.crewMemberId) {
      query = query.eq('crew_member_id', rateEntry.crewMemberId)
    } else {
      query = query.eq('crew_member_name', rateEntry.name)
    }
    // .select('id') and a row count, not the absence of an error: the pay-rate
    // write guard and RLS can both refuse this, and an UPDATE matching nothing
    // returns SUCCESS. This used to `await query` and discard the result
    // entirely, so a refused rate change looked exactly like a saved one.
    const { data, error } = await query.select('id')

    if (error) { setRateError(error.message); return }
    if (!data || data.length === 0) {
      setRateError("Couldn't save — you may not have permission to change pay rates.")
      return
    }

    if (alsoSaveToDirectory && rateEntry.crewMemberId) {
      // Only the id is needed, to choose update vs insert. `select('*')` would
      // pull day_rate, which authenticated no longer holds SELECT on.
      const { data: existingCard } = await supabase
        .from('rate_cards')
        .select('id')
        .eq('crew_member_id', rateEntry.crewMemberId)
        .eq('role', rateEntry.role)
        .maybeSingle()

      const cardResult = existingCard
        ? await supabase.from('rate_cards').update({ day_rate: newRate }).eq('id', existingCard.id)
        : await supabase.from('rate_cards').insert({
            crew_member_id: rateEntry.crewMemberId, role: rateEntry.role, day_rate: newRate,
          })

      if (cardResult.error) {
        // The SHOW rate did save. Say exactly that rather than reporting a
        // failure that would send them back to re-enter a rate already applied.
        setSaveError(`Rate updated on this show, but the Crew Directory was not: ${cardResult.error.message}`)
      }
    }

    closeRateEditor()
    router.refresh()
  }

  function closeRateEditor() {
    setRateEntry(null)
    setRateText('')
    setRateError('')
    setAlsoSaveToDirectory(false)
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl pb-16">
      <Link href={`/dashboard/shows/${show.id}`} className="text-sm text-muted hover:text-ink">← Back to Show</Link>
      <div className="mt-2 mb-6 flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide">Edit Show Details</h1>
        <p className="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted">
          {savedTick > 0 ? 'Saved' : 'Changes save automatically'}
        </p>
      </div>

      {saveError && (
        <div className="mb-4 border-l-[3px] border-danger py-1 pl-3 text-sm text-danger">
          Save failed: {saveError}
        </div>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Show Name (Required)</p>
          {/* Required, so an empty value is never written — the field keeps
              what you typed and says why rather than silently reverting. */}
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => {
              if (!name.trim()) { setSaveError('A show needs a name — this one was not saved.'); return }
              saveTextField('name', name, show.name)
            }}
            className={inputCls}
          />
        </section>

        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Show Dates</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">
              {new Date(show.start_date + 'T00:00:00').toLocaleDateString()} – {new Date(show.end_date + 'T00:00:00').toLocaleDateString()}
            </span>
            <AddDayButton
              showId={show.id}
              hasCrew={crewRateEntries.length > 0}
            />
          </div>
          <p className="text-xs text-muted mt-2">Adding a day takes effect straight away.</p>
        </section>

        <section className="mb-6">
          <p className="mb-1 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Show Timezone</p>
          <Select
            ariaLabel="Show timezone"
            className="mt-2"
            value={timezone}
            onChange={v => { setTimezone(v); saveShow({ timezone_identifier: v }) }}
            options={SHOW_TIMEZONES}
          />
          <p className="text-xs text-muted mt-2">Punch times, the day picker, and reports all use this timezone — useful when you&apos;re prepping a show that&apos;s in a different timezone than you are.</p>
        </section>

        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Admin &amp; Billing (Optional)</p>
          <input
            placeholder="Client / Production Company"
            value={clientCompany}
            onChange={e => setClientCompany(e.target.value)}
            onBlur={() => saveTextField('client_company', clientCompany, show.client_company)}
            className={`${inputCls} mb-3`}
          />
          <input
            placeholder="Job / PO Number"
            value={jobNumber}
            onChange={e => setJobNumber(e.target.value)}
            onBlur={() => saveTextField('job_number', jobNumber, show.job_number)}
            className={inputCls}
          />
        </section>

        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Location &amp; Venue (Optional)</p>
          <input
            placeholder="Venue Name (e.g. McCormick Place)"
            value={venue}
            onChange={e => setVenue(e.target.value)}
            onBlur={() => saveTextField('venue', venue, show.venue)}
            className={`${inputCls} mb-3`}
          />
          <input
            placeholder="City & State (e.g. Chicago, IL)"
            value={cityState}
            onChange={e => setCityState(e.target.value)}
            onBlur={() => saveTextField('city_state', cityState, show.city_state)}
            className={inputCls}
          />
        </section>

        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">General Notes</p>
          <textarea
            placeholder="Logistics, parking info, etc..."
            value={showNotes}
            onChange={e => setShowNotes(e.target.value)}
            onBlur={() => saveTextField('show_notes', showNotes, show.show_notes)}
            rows={4}
            className={inputCls}
          />
        </section>
      </div>

      {/* Whether this show tracks money is a pay decision, so it needs
          can_edit_pay_rates. Hidden outright rather than shown disabled: a
          control you can't use is noise, and the setting's existence isn't
          something a PM needs to know about. */}
      {canEditRates && (
        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Rates &amp; Payroll Calculation</p>
          <FieldRow label="Show Dollar Amounts">
            <Toggle
              checked={showFinancials}
              onChange={v => { setShowFinancials(v); saveShow({ show_financials: v }) }}
              label="Show Dollar Amounts"
            />
          </FieldRow>
          <p className="text-xs text-muted mt-2">Turn this on to enter crew day rates and show dollar totals in reports.</p>
        </section>
      )}

      {/* Two separate gates: the SHOW must track money at all, AND this user
          must be allowed to see rates. Previously only the first was checked,
          so any user who could open Edit Show saw every crew day rate and
          could click one to change it — including a PM with
          can_view_pay_rates and can_edit_pay_rates both false. */}
      {showFinancials && canViewRates && (
        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Crew &amp; Rates</p>
          {crewRateEntries.length === 0 ? (
            <p className="text-sm text-muted">No crew assigned yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {crewRateEntries.map((entry: any) => {
                const amount = shoulderSurferMode ? '•••' : `$${Math.round(entry.dayRate)}`
                const inner = (
                  <>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-ink">{entry.name}</p>
                      <p className="text-xs text-muted">{entry.role}</p>
                    </div>
                    <span className="text-sm font-semibold text-accent">{amount}</span>
                  </>
                )
                const cls = 'flex items-center justify-between rounded-field bg-surface-2 px-4 py-3'
                return canEditRates ? (
                  <button
                    key={entry.name + entry.role}
                    onClick={() => {
                      setRateEntry(entry)
                      setRateText(String(Math.round(entry.dayRate)))
                      setAlsoSaveToDirectory(false)
                      setRateError('')
                    }}
                    className={`${cls} hover:bg-line/40`}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={entry.name + entry.role} className={cls}>{inner}</div>
                )
              })}
            </div>
          )}
          {canEditRates && (
            <p className="text-xs text-muted mt-3">Tap a rate to update it. Changes apply to all of that person&apos;s timecards on this show for that role.</p>
          )}
        </section>
      )}

      {/* Day types — the show's plan for each day, so they live with the show
          rather than on the tracker, where a picker under the date read as
          something the operator had to answer before punching anybody in.
          Each tile saves itself (DayTypePicker owns its own verified write). */}
      {workDays.length > 0 && (
        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Day Types</p>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {workDays.map(wd => (
              <div key={wd.id}>
                <div className={cn('h-1.5 w-full', dayTypeBgClass(wd.day_type) ?? 'bg-line')} />
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="shrink-0 whitespace-nowrap font-mono text-xs font-semibold uppercase text-muted">
                    {new Date(wd.date + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                    })}
                  </span>
                  <DayTypePicker workDayId={wd.id} value={wd.day_type ?? null} className="w-[190px] shrink-0" />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Optional. Shown on the tracker and beside each date in a crew booking request.
          </p>
        </section>
      )}

      {/* Handing the show to a scheduler — an admin act, so it belongs here
          rather than in the tracker's header where it sat beside the punch
          controls it has nothing to do with. */}
      {scheduling && (
        <section className="mb-6">
          <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Scheduling</p>
          <HandoffToSchedulerButton
            showId={show.id}
            approvedAt={show.call_approved_at ?? null}
            schedulerName={scheduling.schedulerName}
            positionCount={scheduling.positionCount}
            callSize={scheduling.callSize}
          />
        </section>
      )}

      {rs && (
        <>
          {/* can_manage_rulesets gated the "save as preset" card below but not
              the rules themselves, so a PM without it could rewrite this show's
              OT thresholds, meal penalties and travel rate. Hidden rather than
              rendered read-only, per the same rule as the card above. The
              tracker already shows computed ST/OT/DT totals, so a PM doesn't
              need the thresholds themselves to do their job. */}
          {canManageRulesets && (
            <RulesetFields values={rs} onChange={updateRuleset} showFinancials={showFinancials} />
          )}

          {canManageRulesets && organizationId && (
            <section className="mb-6">
              <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">Reuse These Rules</p>
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
            </section>
          )}
        </>
      )}

      {presetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge">
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
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge">
            <h2 className="text-lg font-bold text-ink mb-1">Edit Day Rate</h2>
            <p className="text-sm text-muted mb-4">New day rate for {rateEntry.name} ({rateEntry.role})</p>
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              value={rateText}
              onChange={e => { setRateText(e.target.value); setRateError('') }}
              // Enter saves, Escape backs out — the keys you expect from a field
              // with one obvious action. Reaching for the mouse to commit a
              // number you have just typed is the complaint this fixes.
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRateEdit() }
                if (e.key === 'Escape') { e.preventDefault(); closeRateEditor() }
              }}
              className={inputCls}
            />
            <p className="mt-2 text-xs text-muted">
              Applies to every day {rateEntry.name.split(' ')[0]} works this show as {rateEntry.role || 'this role'}.
            </p>

            {/* The second question, asked BEFORE saving rather than as a popup
                afterwards. Only offered for someone who is in the directory —
                a name-only timecard has no rate card to write. */}
            {rateEntry.crewMemberId && (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-sm text-ink">
                  Also update their saved rate
                  <span className="block text-xs text-muted">Their default for future shows, in the Crew Directory.</span>
                </span>
                <Toggle
                  checked={alsoSaveToDirectory}
                  onChange={setAlsoSaveToDirectory}
                  label="Also update their saved rate in the Crew Directory"
                />
              </div>
            )}

            {rateError && <p className="mt-3 text-xs text-danger">{rateError}</p>}

            <div className="mt-4 flex gap-3">
              <Button variant="ghost" className="flex-1 py-3" onClick={closeRateEditor}>Cancel</Button>
              <Button className="flex-1 py-3" onClick={commitRateEdit}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {children}
    </div>
  )
}
