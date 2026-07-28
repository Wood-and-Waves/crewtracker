'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'

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

export type CallLine = { role: string; quantity: number }

export default function CallLinesEditor({
  roles,
  lines,
  onChange,
}: {
  roles: string[]
  lines: CallLine[]
  onChange: (next: CallLine[]) => void
}) {
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState(1)

  function add() {
    if (!role) return
    // Adding a role already on the list bumps its count rather than creating a
    // second identical line — two "Stagehand ×1" rows say the same thing as
    // one "×2" and only make the list harder to read.
    const existing = lines.findIndex(l => l.role === role)
    if (existing >= 0) {
      const next = [...lines]
      next[existing] = { ...next[existing], quantity: next[existing].quantity + quantity }
      onChange(next)
    } else {
      onChange([...lines, { role, quantity }])
    }
    setRole('')
    setQuantity(1)
  }

  const total = lines.reduce((n, l) => n + l.quantity, 0)

  return (
    <div>
      {lines.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {lines.map(l => (
            <li
              key={l.role}
              className="flex items-center gap-1.5 rounded-pill border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-xs text-ink"
            >
              <span className="font-semibold">{l.quantity}×</span> {l.role}
              <button
                type="button"
                onClick={() => onChange(lines.filter(x => x.role !== l.role))}
                aria-label={`Remove ${l.role}`}
                className="rounded-full px-1.5 text-muted hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
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

      {total > 0 && (
        <p className="mt-1.5 text-[11px] text-muted">
          {total} position{total === 1 ? '' : 's'} on this call
        </p>
      )}
    </div>
  )
}
