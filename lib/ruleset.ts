// Shared shape of a payroll rule set — the columns that payroll_rulesets (one
// per show) and payroll_presets (org-level templates) have in common.
//
// Plain module (no 'use client') so it is safe to import from client components
// AND Server Components — see CLAUDE.md "Past incidents" on the client/server
// export rule.

export type RulesetValues = {
  overtime_after_hours: number
  double_time_enabled: boolean
  double_time_after_hours: number
  travel_rate: string
  meal_penalty_enabled: boolean
  meal_penalty_grace_period: number
  meal_penalty_amount: number
  continuous_time_enabled: boolean
  minimum_meal_break_enabled: boolean
  minimum_meal_break_minutes: number
  meal_break_deduction_cap: number
  short_turn_penalty_enabled: boolean
  short_turn_rest_hours: number
  /** What a cancelled day pays, % of day rate (0–100). 0027. */
  cancellation_pay_percent: number
}

// Single source of truth for which columns make up a rule set. Used to build
// update payloads and to copy a preset into a show's ruleset, so adding a rule
// in future means touching this list rather than hunting call sites.
export const RULESET_FIELDS = [
  'overtime_after_hours',
  'double_time_enabled',
  'double_time_after_hours',
  'travel_rate',
  'meal_penalty_enabled',
  'meal_penalty_grace_period',
  'meal_penalty_amount',
  'continuous_time_enabled',
  'minimum_meal_break_enabled',
  'minimum_meal_break_minutes',
  'meal_break_deduction_cap',
  'short_turn_penalty_enabled',
  'short_turn_rest_hours',
  'cancellation_pay_percent',
] as const satisfies readonly (keyof RulesetValues)[]

/**
 * The starting rule set for something being composed in the browser — a new
 * payroll preset, today.
 *
 * These MIRROR the column defaults in scripts/sql/schema.sql (verified
 * 2026-08-06), so a preset built and saved without touching a field lands on
 * exactly what the database would have chosen for itself. If a default changes
 * in a migration, change it here too — nothing enforces the match, because the
 * browser never sees the DDL.
 */
export const DEFAULT_RULESET_VALUES: RulesetValues = {
  overtime_after_hours: 10,
  double_time_enabled: false,
  double_time_after_hours: 12,
  travel_rate: 'halfDay',
  meal_penalty_enabled: false,
  meal_penalty_grace_period: 6,
  meal_penalty_amount: 0,
  continuous_time_enabled: false,
  minimum_meal_break_enabled: true,
  minimum_meal_break_minutes: 60,
  meal_break_deduction_cap: 60,
  short_turn_penalty_enabled: false,
  short_turn_rest_hours: 10,
  cancellation_pay_percent: 0,
}

/** Picks just the rule columns off any row that carries them. */
export function pickRulesetValues(row: Record<string, any>): RulesetValues {
  const out: Record<string, any> = {}
  for (const f of RULESET_FIELDS) out[f] = row[f]
  return out as RulesetValues
}

/**
 * Applies one field change, keeping Continuous Time and the Working Lunch Rule
 * mutually exclusive: one pays straight through, the other deducts meal breaks.
 * Turning either on turns the other off, matching iOS.
 */
export function applyRulesetChange<T extends Record<string, any>>(
  prev: T,
  field: string,
  value: any,
): T {
  const next: Record<string, any> = { ...prev, [field]: value }
  if (field === 'continuous_time_enabled' && value) next.minimum_meal_break_enabled = false
  if (field === 'minimum_meal_break_enabled' && value) next.continuous_time_enabled = false
  return next as T
}
