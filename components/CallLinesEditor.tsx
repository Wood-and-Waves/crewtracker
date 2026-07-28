'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import {
  DAY_SCOPE_LABELS, shortScope, daysCoveredBy, type DayScope,
} from '@/lib/crewCall'

// Building a crew call as a list: 1 × A1, 1 × V1, 2 × Stagehand.
//
// A call is ONE THOUGHT — "main stage is an A1, a V1 and two stagehands" — and
// the first version of this made you enter it as three separate saves. Lines
// stack up here and are committed once by whatever is hosting the editor, so
// the shape of the UI matches the shape of the decision.
//
// Controlled and storage-agnostic on purpose: New Show holds these in memory
// for a room that does not exist yet, while the crew call panel commits them
// straight to an existing room. Same component, because they are the same idea.

export type CallLine = {
  role: string
  quantity: number
  /**
   * Which days of the run this line covers. Riggers are first-and-last, a
   * teleprompter operator is often middle-days-only. Defaults to every day.
   */
  scope: DayScope
}

export default function CallLinesEditor({
  roles,
  lines,
  onChange,
  dayCount,
}: {
  roles: string[]
  lines: CallLine[]
  onChange: (next: CallLine[]) => void
  /**
   * Length of the run. Supplied only where the editor spans the whole show
   * (New Show); the per-day crew call panel already targets one day and its
   * own "apply to remaining days" toggle, so offering a scope there as well
   * would be two controls answering the same question.
   */
  dayCount?: number
}) {
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [scope, setScope] = useState<DayScope>('all')
  const showScope = typeof dayCount === 'number' && dayCount > 1

  function add() {
    if (!role) return
    // Adding a role already on the list bumps its count rather than creating a
    // second identical line — two "Stagehand ×1" rows say the same thing as
    // one "×2" and only make the list harder to read. Matching on role AND
    // scope, because "2 riggers on the first day" and "2 riggers throughout"
    // are genuinely different lines.
    const existing = lines.findIndex(l => l.role === role && l.scope === scope)
    if (existing >= 0) {
      const next = [...lines]
      next[existing] = { ...next[existing], quantity: next[existing].quantity + quantity }
      onChange(next)
    } else {
      onChange([...lines, { role, quantity, scope }])
    }
    setRole('')
    setQuantity(1)
    setScope('all')
  }

  const total = lines.reduce((n, l) => n + l.quantity, 0)

  return (
    <div>
      {lines.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {lines.map(l => {
            const scopeLabel = shortScope(l.scope)
            return (
              <li
                key={`${l.role}|${l.scope}`}
                className="flex items-center gap-1.5 rounded-pill border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-xs text-ink"
              >
                <span className="font-semibold">{l.quantity}×</span> {l.role}
                {scopeLabel && <span className="text-muted">· {scopeLabel}</span>}
                <button
                  type="button"
                  onClick={() => onChange(lines.filter(x => !(x.role === l.role && x.scope === l.scope)))}
                  aria-label={`Remove ${l.role}`}
                  className="rounded-full px-1.5 text-muted hover:text-danger"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex gap-2">
        {/* key tied to the options: iPad Safari has a hydration bug that
            duplicates <option> inside a controlled <select>. */}
        <select
          key={roles.join(',')}
          value={role}
          onChange={e => setRole(e.target.value)}
          className="min-w-0 flex-1 rounded-field border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="" className="bg-surface-2 text-ink">Add a role…</option>
          {roles.map(r => (
            <option key={r} value={r} className="bg-surface-2 text-ink">{r}</option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={20}
          value={quantity}
          onChange={e => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          aria-label="How many"
          className="w-14 rounded-field border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
        />
        <Button type="button" size="sm" variant="ghost" onClick={add} disabled={!role}>
          Add
        </Button>
      </div>

      {showScope && (
        <select
          value={scope}
          onChange={e => setScope(e.target.value as DayScope)}
          aria-label="Which days this role is needed"
          className="mt-1.5 w-full rounded-field border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
        >
          {(Object.keys(DAY_SCOPE_LABELS) as DayScope[]).map(k => {
            const covered = daysCoveredBy(k, dayCount!)
            return (
              <option key={k} value={k} disabled={covered === 0} className="bg-surface-2 text-ink">
                {DAY_SCOPE_LABELS[k]}
                {/* A 2-day show has no middle, so the option is offered but
                    disabled rather than silently adding nothing. */}
                {covered === 0 ? ' — none on this run' : ''}
              </option>
            )
          })}
        </select>
      )}

      {total > 0 && (
        <p className="mt-1.5 text-[11px] text-muted">
          {/* Per day, not the row total: a 12-person call over 5 days is 60
              rows, and that is not a number anybody crews against. */}
          {showScope
            ? `${lines.filter(l => l.scope === 'all').reduce((n, l) => n + l.quantity, 0)} crew every day` +
              (lines.some(l => l.scope !== 'all') ? ', plus part-run roles' : '')
            : `${total} position${total === 1 ? '' : 's'} on this call`}
        </p>
      )}
    </div>
  )
}
