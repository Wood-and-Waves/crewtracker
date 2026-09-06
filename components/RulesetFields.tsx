'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import Toggle from '@/components/ui/Toggle'
import { RULE_MAJOR } from '@/lib/panel'
import { cn } from '@/lib/cn'
import type { RulesetValues } from '@/lib/ruleset'

// The payroll rule form, shared by Edit Show (one ruleset per show) and the
// Payroll Presets editor (org-level templates) so the two can never drift.
//
// Deliberately presentational: it renders `values` and reports every change
// through `onChange`. Mutual exclusion between Continuous Time and the Working
// Lunch Rule lives in applyRulesetChange (lib/ruleset.ts), which both callers
// funnel their onChange through.

const numberInputCls =
  'w-20 rounded-field bg-surface-2 border border-line px-2 py-1.5 text-sm text-ink text-right outline-none focus:border-accent'

// Ruled rows: label left, control right, a hairline between rows — the Open
// Paper form register (rule weight instead of enclosure).
function FieldRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 last:border-b-0">
      <span className="text-sm text-ink flex items-center gap-1.5">{label}</span>
      {children}
    </div>
  )
}

// A rule group's heading: condensed caps over a 3px ink rule, replacing the
// Card each group used to sit in.
function GroupHead({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(RULE_MAJOR, 'mb-1 pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink')}>
      {children}
    </p>
  )
}

export default function RulesetFields({
  values,
  onChange,
  showFinancials = true,
}: {
  values: RulesetValues
  onChange: (field: string, value: any) => void
  /** Gates the dollar-denominated Penalty Amount only. Hour rules always show. */
  showFinancials?: boolean
}) {
  const [showSTAInfo, setShowSTAInfo] = useState(false)
  const [showMealInfo, setShowMealInfo] = useState(false)

  return (
    <>
      <section className="mb-6">
        <GroupHead>Hours &amp; Pay Rates</GroupHead>

        <div className="border-b border-line py-2.5">
          <label className="text-sm text-ink block mb-1.5">Travel Day Pay</label>
          <Select
            ariaLabel="Travel day pay"
            size="sm"
            value={values.travel_rate}
            onChange={v => onChange('travel_rate', v)}
            options={[
              { value: 'halfDay', label: 'Half Day' },
              { value: 'fullDay', label: 'Full Day' },
            ]}
          />
        </div>

        {/* What a day the company CANCELLED pays, as a share of the day rate.
            0 means nothing — the default, so no existing show changes. A
            no-show has no setting: it pays nothing. (0027) */}
        <FieldRow label="Cancellation Pay">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={values.cancellation_pay_percent ?? 0}
              onChange={e => onChange('cancellation_pay_percent', Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="w-20 rounded-field border border-line bg-surface-2 px-3 py-1.5 text-right text-sm text-ink tabular-nums outline-none focus:border-accent"
              aria-label="Cancellation pay, percent of day rate"
            />
            % of day rate
          </span>
        </FieldRow>

        <FieldRow label="Overtime Starts After">
          <div className="flex items-center gap-2">
            <input
              type="number" step={0.5} min={0} max={24}
              value={values.overtime_after_hours}
              onChange={e => onChange('overtime_after_hours', parseFloat(e.target.value) || 0)}
              className={numberInputCls}
            />
            <span className="text-sm text-muted">hrs</span>
          </div>
        </FieldRow>

        <FieldRow label="Enable Double Time">
          <Toggle checked={values.double_time_enabled} onChange={v => onChange('double_time_enabled', v)} label="Enable Double Time" />
        </FieldRow>

        {values.double_time_enabled && (
          <FieldRow label="Double Time Starts After">
            <div className="flex items-center gap-2">
              <input
                type="number" step={0.5} min={0} max={24}
                value={values.double_time_after_hours}
                onChange={e => onChange('double_time_after_hours', parseFloat(e.target.value) || 0)}
                className={numberInputCls}
              />
              <span className="text-sm text-muted">hrs</span>
            </div>
          </FieldRow>
        )}

        <p className="text-xs text-muted mt-3">Crew are paid their full day rate up to the Overtime threshold. Hours beyond that are paid at 1.5×. Double time (2×) is optional and kicks in after its own threshold.</p>
      </section>

      <section className="mb-6">
        <GroupHead>Continuous Time</GroupHead>

        <FieldRow label="Continuous Time">
          <Toggle
            checked={values.continuous_time_enabled}
            onChange={v => onChange('continuous_time_enabled', v)}
            label="Continuous Time"
          />
        </FieldRow>

        <p className="text-xs text-muted mt-3">Crew are paid from start to wrap with no meal break deductions. OT and DT still apply after their thresholds. Turning this on switches off the Working Lunch Rule below.</p>
      </section>

      <section className="mb-6">
        <GroupHead>Meal Rules</GroupHead>

        <FieldRow label="Meal Penalties">
          <Toggle checked={values.meal_penalty_enabled} onChange={v => onChange('meal_penalty_enabled', v)} label="Meal Penalties" />
        </FieldRow>

        {values.meal_penalty_enabled && (
          <>
            <FieldRow label="Grace Period">
              <div className="flex items-center gap-2">
                <input
                  type="number" step={0.5} min={0} max={12}
                  value={values.meal_penalty_grace_period}
                  onChange={e => onChange('meal_penalty_grace_period', parseFloat(e.target.value) || 0)}
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
                    value={values.meal_penalty_amount}
                    onChange={e => onChange('meal_penalty_amount', parseFloat(e.target.value) || 0)}
                    className={numberInputCls}
                  />
                  <span className="text-sm text-muted">{values.meal_penalty_amount > 0 ? '$' : '(OT Rate)'}</span>
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
          <Toggle checked={values.minimum_meal_break_enabled} onChange={v => onChange('minimum_meal_break_enabled', v)} label="Working Lunch Rule" />
        </FieldRow>

        {values.minimum_meal_break_enabled && (
          <>
            <FieldRow label="Minimum Break Length">
              <div className="flex items-center gap-2">
                <input
                  type="number" step={15} min={15} max={120}
                  value={values.minimum_meal_break_minutes}
                  onChange={e => onChange('minimum_meal_break_minutes', parseFloat(e.target.value) || 0)}
                  className={numberInputCls}
                />
                <span className="text-sm text-muted">min</span>
              </div>
            </FieldRow>
            <FieldRow label="Max Deduction Per Break">
              <div className="flex items-center gap-2">
                <input
                  type="number" step={15} min={15} max={120}
                  value={values.meal_break_deduction_cap}
                  onChange={e => onChange('meal_break_deduction_cap', parseFloat(e.target.value) || 0)}
                  className={numberInputCls}
                />
                <span className="text-sm text-muted">min</span>
              </div>
            </FieldRow>
          </>
        )}

        <p className="text-xs text-muted mt-3">Meal penalties are charged when crew go too long without a break. The working lunch rule controls whether short breaks count as paid work time.</p>
      </section>

      <section className="mb-6">
        <GroupHead>Turnaround</GroupHead>

        <FieldRow
          label={<>Short Turnaround Penalty
            <button onClick={() => setShowSTAInfo(true)} className="text-accent">ⓘ</button>
          </>}
        >
          <Toggle checked={values.short_turn_penalty_enabled} onChange={v => onChange('short_turn_penalty_enabled', v)} label="Short Turnaround Penalty" />
        </FieldRow>

        {values.short_turn_penalty_enabled && (
          <FieldRow label="Minimum Rest Between Shifts">
            <div className="flex items-center gap-2">
              <input
                type="number" step={0.5} min={0} max={24}
                value={values.short_turn_rest_hours}
                onChange={e => onChange('short_turn_rest_hours', parseFloat(e.target.value) || 0)}
                className={numberInputCls}
              />
              <span className="text-sm text-muted">hrs</span>
            </div>
          </FieldRow>
        )}

        <p className="text-xs text-muted mt-3">A short turnaround (forced call) occurs when a crew member doesn&apos;t get enough rest between shifts. Their entire next day is paid at double time.</p>
      </section>

      {showSTAInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowSTAInfo(false)}>
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge" onClick={e => e.stopPropagation()}>
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
          <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge" onClick={e => e.stopPropagation()}>
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
    </>
  )
}
