'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'

// Pick a role and a quantity, press Add. That is the whole component.
//
// It existed twice — once inside CrewCallGrid's cell editor and once inside
// CallLinesEditor — with the same classes, the same 1-20 clamp and the same
// iPad-Safari workaround copied between them. Two copies of a control this
// small is how they drift: fix the clamp in one and the other keeps the bug.
//
// Owns its own draft state (which role, how many) because that state is
// meaningless outside the act of adding one line. What happens to the line is
// the caller's business: the grid writes it straight into a cell, the call
// editor stacks it onto a list.

export default function RolePicker({
  roles,
  onAdd,
  disabled,
}: {
  roles: string[]
  onAdd: (role: string, quantity: number) => void
  disabled?: boolean
}) {
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState(1)

  function submit() {
    if (!role) return
    onAdd(role, quantity)
    setRole('')
    setQuantity(1)
  }

  return (
    <div className="flex gap-2">
      <Select
        ariaLabel="Role"
        size="sm"
        className="min-w-0 flex-1"
        value={role}
        onChange={setRole}
        disabled={disabled}
        options={[
          { value: '', label: 'Add a role…' },
          ...roles.map(r => ({ value: r, label: r })),
        ]}
      />
      <input
        type="number"
        min={1}
        max={20}
        value={quantity}
        onChange={e => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
        aria-label="How many"
        disabled={disabled}
        className="w-14 rounded-field border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
      />
      <Button type="button" size="sm" variant="ghost" onClick={submit} disabled={disabled || !role}>
        Add
      </Button>
    </div>
  )
}
