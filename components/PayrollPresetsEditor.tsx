'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { applyRulesetChange, pickRulesetValues, DEFAULT_RULESET_VALUES, type RulesetValues } from '@/lib/ruleset'
import RulesetFields from '@/components/RulesetFields'
import Button from '@/components/ui/Button'
import { RULE_MAJOR } from '@/lib/panel'
import { cn } from '@/lib/cn'

type Preset = { id: string; name: string; is_default: boolean; sort_order: number } & RulesetValues

const inputCls =
  'rounded-field bg-surface-2 border border-line px-3 py-2 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function PayrollPresetsEditor({
  organizationId,
  initialPresets,
}: {
  organizationId: string
  initialPresets: Preset[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [presets, setPresets] = useState<Preset[]>(initialPresets)
  // ONE composer, always on screen. `editingId` null = composing a new preset;
  // set = editing that one. The old shape had a name-only "Add" that INSERTED
  // an empty preset immediately and then revealed the rules, so abandoning it
  // left a junk row, and the only way to edit an existing preset was to know
  // that its name was secretly a button. Nothing is written now until Save.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draft, setDraft] = useState<RulesetValues>(DEFAULT_RULESET_VALUES)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function fail(e: { code?: string; message: string } | null, dupeMsg: string) {
    if (!e) return false
    setError(e.code === '23505' ? dupeMsg : e.message)
    return true
  }

  function editPreset(p: Preset) {
    setEditingId(p.id)
    setDraftName(p.name)
    setDraft(pickRulesetValues(p))
    setError('')
  }

  /** Back to composing a new one — also what Cancel does. */
  function resetComposer() {
    setEditingId(null)
    setDraftName('')
    setDraft(DEFAULT_RULESET_VALUES)
    setError('')
  }

  async function save() {
    const trimmed = draftName.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')

    if (editingId) {
      const { data, error: e } = await supabase
        .from('payroll_presets')
        .update({ name: trimmed, ...draft })
        .eq('id', editingId)
        .select('id')
      setBusy(false)
      if (fail(e, `"${trimmed}" already exists.`)) return
      if (!data || data.length === 0) {
        setError("Couldn't save — you may not have permission to change presets.")
        return
      }
      setPresets(prev => prev.map(p => (p.id === editingId ? { ...p, name: trimmed, ...draft } : p)))
      resetComposer()
      router.refresh()
      return
    }

    const nextSort = presets.length > 0 ? Math.max(...presets.map(p => p.sort_order)) + 1 : 0
    const { data, error: e } = await supabase
      .from('payroll_presets')
      .insert({ organization_id: organizationId, name: trimmed, sort_order: nextSort, ...draft })
      .select()
      .single()
    setBusy(false)
    if (fail(e, `"${trimmed}" already exists.`)) return
    if (data) {
      setPresets(prev => [...prev, data])
      resetComposer()
      router.refresh()
    }
  }

  async function makeDefault(id: string) {
    setBusy(true)
    setError('')
    // One default per org is enforced by a partial unique index, so clear the
    // current default before setting the new one.
    const clear = await supabase
      .from('payroll_presets')
      .update({ is_default: false })
      .eq('organization_id', organizationId)
      .eq('is_default', true)
    if (clear.error) { setBusy(false); setError(clear.error.message); return }

    const { error: e } = await supabase.from('payroll_presets').update({ is_default: true }).eq('id', id)
    setBusy(false)
    if (e) { setError(e.message); return }
    setPresets(prev => prev.map(p => ({ ...p, is_default: p.id === id })))
    router.refresh()
  }

  async function duplicate(p: Preset) {
    setBusy(true)
    setError('')
    // Never inherit is_default — that column allows only one per org.
    let candidate = `${p.name} (copy)`
    let n = 2
    while (presets.some(x => x.name.toLowerCase() === candidate.toLowerCase())) {
      candidate = `${p.name} (copy ${n++})`
    }
    const nextSort = Math.max(...presets.map(x => x.sort_order)) + 1
    const { data, error: e } = await supabase
      .from('payroll_presets')
      .insert({
        organization_id: organizationId,
        name: candidate,
        sort_order: nextSort,
        ...pickRulesetValues(p),
      })
      .select()
      .single()
    setBusy(false)
    if (fail(e, `"${candidate}" already exists.`)) return
    if (data) setPresets(prev => [...prev, data])
  }

  async function remove(p: Preset) {
    if (!confirm(
      `Delete the "${p.name}" preset?\n\nShows already created from it keep their own rules — nothing on an existing show changes.`
    )) return
    setBusy(true)
    setError('')
    const { error: e } = await supabase.from('payroll_presets').delete().eq('id', p.id)
    setBusy(false)
    if (e) { setError(e.message); return }
    setPresets(prev => prev.filter(x => x.id !== p.id))
    if (editingId === p.id) resetComposer()
    router.refresh()
  }

  function summarize(p: Preset): string {
    const bits = [`OT after ${p.overtime_after_hours}h`]
    if (p.double_time_enabled) bits.push(`DT after ${p.double_time_after_hours}h`)
    if (p.continuous_time_enabled) bits.push('continuous time')
    else if (p.minimum_meal_break_enabled) bits.push(`working lunch ${p.minimum_meal_break_minutes}/${p.meal_break_deduction_cap}m`)
    if (p.meal_penalty_enabled) bits.push('meal penalties')
    if (p.short_turn_penalty_enabled) bits.push(`turnaround ${p.short_turn_rest_hours}h`)
    return bits.join(' · ')
  }

  const editing = presets.find(p => p.id === editingId) || null

  return (
    <div className="border-t border-line pt-4">
      {/* The section header says what presets are; this says the thing it does
          not — that a preset is copied, so editing one never rewrites a show
          that already exists. */}
      <p className="mb-4 text-xs text-muted">
        The one marked Default is pre-selected. Picking a preset{' '}
        <span className="text-ink">copies</span> its rules into that show — editing or deleting
        a preset later never changes a show that already exists.
      </p>

      {presets.length === 0 ? (
        <p className="mb-6 text-sm text-muted">No presets yet — build your first one below.</p>
      ) : (
        <div className={cn('mb-8 border-t border-line', RULE_MAJOR)}>
          {presets.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  {p.is_default && (
                    <span className="bg-accent-wash px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                      Default
                    </span>
                  )}
                  {editingId === p.id && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Editing</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">{summarize(p)}</p>
              </div>
              <div className="flex items-center gap-1">
                {/* Edit is a real labelled action now. It used to be the name
                    itself — an affordance nobody could see. */}
                <button onClick={() => editPreset(p)} disabled={busy}
                  className="rounded-field px-2 py-1 text-xs font-semibold text-accent hover:opacity-80 disabled:opacity-40">
                  Edit
                </button>
                {!p.is_default && (
                  <button onClick={() => makeDefault(p.id)} disabled={busy}
                    className="rounded-field px-2 py-1 text-xs text-muted hover:text-accent disabled:opacity-40">
                    Make default
                  </button>
                )}
                <button onClick={() => duplicate(p)} disabled={busy}
                  className="rounded-field px-2 py-1 text-xs text-muted hover:text-ink disabled:opacity-40">
                  Duplicate
                </button>
                <button onClick={() => remove(p)} disabled={busy}
                  className="rounded-field px-2 py-1 text-xs text-muted hover:text-danger disabled:opacity-40">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The composer. Always here, whether you are adding or editing — the
          rules are the point of a preset, so they are never hidden behind a
          name field. */}
      <div>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 border-b-[3px] border-ink pb-1.5">
          <p className="font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">
            {editing ? `Editing ${editing.name}` : 'New Preset'}
          </p>
          {editing && (
            <button onClick={resetComposer} className="text-xs text-muted hover:text-ink">
              Cancel — start a new one instead
            </button>
          )}
        </div>

        <input
          placeholder="Preset name (e.g. Corporate Standard)"
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          className={cn(inputCls, 'mb-5 w-full px-4 py-3')}
        />

        <RulesetFields values={draft} onChange={(f, v) => setDraft(prev => applyRulesetChange(prev, f, v))} />

        {error && <p className="mb-3 text-xs text-danger">{error}</p>}
        <div className="flex gap-3">
          {editing && (
            <Button variant="ghost" className="flex-1 py-3" onClick={resetComposer}>Cancel</Button>
          )}
          <Button className="flex-1 py-3" onClick={save} disabled={busy || !draftName.trim()}>
            {busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Preset'}
          </Button>
        </div>
      </div>
    </div>
  )
}
