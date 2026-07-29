'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { applyRulesetChange, pickRulesetValues, type RulesetValues } from '@/lib/ruleset'
import RulesetFields from '@/components/RulesetFields'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
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
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draft, setDraft] = useState<RulesetValues | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function fail(e: { code?: string; message: string } | null, dupeMsg: string) {
    if (!e) return false
    setError(e.code === '23505' ? dupeMsg : e.message)
    return true
  }

  function openEditor(p: Preset) {
    setEditingId(p.id)
    setDraftName(p.name)
    setDraft(pickRulesetValues(p))
    setError('')
  }

  function closeEditor() {
    setEditingId(null)
    setDraft(null)
    setDraftName('')
    setError('')
  }

  async function addPreset() {
    const trimmed = newName.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    const nextSort = presets.length > 0 ? Math.max(...presets.map(p => p.sort_order)) + 1 : 0
    const { data, error: e } = await supabase
      .from('payroll_presets')
      .insert({ organization_id: organizationId, name: trimmed, sort_order: nextSort })
      .select()
      .single()
    setBusy(false)
    if (fail(e, `"${trimmed}" already exists.`)) return
    if (data) {
      setPresets(prev => [...prev, data])
      setNewName('')
      openEditor(data)
    }
  }

  async function saveEditing() {
    if (!editingId || !draft) return
    const trimmed = draftName.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    const { error: e } = await supabase
      .from('payroll_presets')
      .update({ name: trimmed, ...draft })
      .eq('id', editingId)
    setBusy(false)
    if (fail(e, `"${trimmed}" already exists.`)) return
    setPresets(prev => prev.map(p => (p.id === editingId ? { ...p, name: trimmed, ...draft } : p)))
    closeEditor()
    router.refresh()
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
    if (editingId === p.id) closeEditor()
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

      <div className="flex flex-col gap-2 mb-4">
        {presets.length === 0 && <p className="text-sm text-muted">No presets yet. Add one below.</p>}
        {presets.map(p => (
          <div key={p.id} className="rounded-field bg-surface-2 p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => openEditor(p)} className="text-sm font-semibold text-ink hover:text-accent">
                {p.name}
              </button>
              {p.is_default && (
                <span className="rounded-pill bg-accent-wash px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                  Default
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
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
            <p className="mt-1 text-xs text-muted">{summarize(p)}</p>
          </div>
        ))}
      </div>

      {error && !editingId && <p className="text-xs text-danger mb-3">{error}</p>}

      <div className="flex gap-2">
        <input
          placeholder="New preset name (e.g. Corporate Standard)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addPreset()}
          className={`${inputCls} flex-1`}
        />
        <Button size="sm" onClick={addPreset} disabled={busy || !newName.trim()}>Add</Button>
      </div>

      {editing && draft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl my-8">
            <Card className="p-5 mb-4">
              <p className="text-xs uppercase tracking-wide text-muted mb-3">Preset Name</p>
              <input
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                className={cn(inputCls, 'w-full px-4 py-3')}
              />
            </Card>

            <RulesetFields values={draft} onChange={(f, v) => setDraft(prev => (prev ? applyRulesetChange(prev, f, v) : prev))} />

            <Card className="p-5">
              {error && <p className="text-xs text-danger mb-3">{error}</p>}
              <div className="flex gap-3">
                <Button variant="ghost" className="flex-1 py-3" onClick={closeEditor}>Cancel</Button>
                <Button className="flex-1 py-3" onClick={saveEditing} disabled={busy || !draftName.trim()}>
                  {busy ? 'Saving…' : 'Save Preset'}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
