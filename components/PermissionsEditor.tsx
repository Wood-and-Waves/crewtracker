'use client'

import { useState } from 'react'
import Toggle from '@/components/ui/Toggle'
import { cn } from '@/lib/cn'
import {
  ROLES,
  VISIBLE_PERMISSIONS,
  presetFor,
  type Role,
  type PermissionKey,
  type PermissionValues,
} from '@/lib/permissions'

export default function PermissionsEditor({
  role,
  values,
  onChange,
  lockedKeys = [],
}: {
  role: Role
  values: PermissionValues
  onChange: (next: { role: Role; values: PermissionValues }) => void
  lockedKeys?: PermissionKey[]
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function selectRole(nextRole: Role) {
    // Applying a preset overrides all keys EXCEPT locked ones (which keep
    // their current value — e.g. an admin editing themselves can't lose
    // Manage Users just by picking a lower role).
    const preset = presetFor(nextRole)
    for (const key of lockedKeys) preset[key] = values[key]
    onChange({ role: nextRole, values: preset })
  }

  function toggleKey(key: PermissionKey, next: boolean) {
    onChange({ role, values: { ...values, [key]: next } })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Role picker */}
      <div>
        <p className="mb-2 text-sm font-semibold text-ink">Role</p>
        <div className="flex gap-2">
          {ROLES.map(r => {
            const active = r.value === role
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => selectRole(r.value)}
                className={cn(
                  'rounded-field border px-4 py-2 text-sm font-semibold transition-colors',
                  active
                    ? 'border-accent bg-accent-wash text-accent'
                    : 'border-line bg-surface text-muted hover:text-ink',
                )}
              >
                {r.label}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          Picking a role sets a standard set of permissions. Fine-tune below if needed.
        </p>
      </div>

      {/* Advanced toggles */}
      <div className="rounded-card border border-line">
        <button
          type="button"
          onClick={() => setAdvancedOpen(o => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ink"
        >
          Advanced permissions
          <span className="text-muted">{advancedOpen ? '−' : '+'}</span>
        </button>
        {advancedOpen && (
          <div className="border-t border-line px-4 py-3">
            {VISIBLE_PERMISSIONS.map(({ key, label }) => {
              const locked = lockedKeys.includes(key)
              return (
                <div key={key} className="flex items-center justify-between py-2">
                  <span className="text-sm text-ink">
                    {label}
                    {locked && <span className="ml-2 text-xs text-muted">(locked)</span>}
                  </span>
                  <Toggle
                    checked={values[key]}
                    onChange={next => toggleKey(key, next)}
                    disabled={locked}
                    label={label}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
