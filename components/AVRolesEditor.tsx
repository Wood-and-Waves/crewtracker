'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

type AVRole = { id: string; name: string; sort_order: number }

const inputCls =
  'rounded-field bg-surface-2 border border-line px-3 py-2 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function AVRolesEditor({
  organizationId,
  initialRoles,
}: {
  organizationId: string
  initialRoles: AVRole[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [roles, setRoles] = useState(initialRoles)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function isDuplicate(name: string, excludeId?: string) {
    const trimmed = name.trim().toLowerCase()
    return roles.some(r => r.id !== excludeId && r.name.trim().toLowerCase() === trimmed)
  }

  async function addRole() {
    const trimmed = newName.trim()
    if (!trimmed) return
    if (isDuplicate(trimmed)) {
      setError(`"${trimmed}" already exists.`)
      return
    }
    setError('')
    setBusy(true)
    const nextSort = roles.length > 0 ? Math.max(...roles.map(r => r.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('av_roles')
      .insert({ organization_id: organizationId, name: trimmed, sort_order: nextSort })
      .select()
      .single()
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setRoles(prev => [...prev, data])
    setNewName('')
  }

  async function renameRole(id: string) {
    const trimmed = editingName.trim()
    if (!trimmed) return
    if (isDuplicate(trimmed, id)) {
      setError(`"${trimmed}" already exists.`)
      return
    }
    setError('')
    setBusy(true)
    const { error } = await supabase.from('av_roles').update({ name: trimmed }).eq('id', id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setRoles(prev => prev.map(r => (r.id === id ? { ...r, name: trimmed } : r)))
    setEditingId(null)
    router.refresh()
  }

  async function deleteRole(id: string) {
    setBusy(true)
    const { error } = await supabase.from('av_roles').delete().eq('id', id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setRoles(prev => prev.filter(r => r.id !== id))
    router.refresh()
  }

  // Roles are shown alphabetically everywhere. Manual up/down reordering used to
  // live here and was more fiddly than useful — with 31 seeded roles, finding
  // one alphabetically beats remembering where you put it. The sort_order column
  // stays (new rows still get one) but nothing reads it for display any more.
  const sortedRoles = [...roles].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return (
    <div className="border-t border-line pt-4">

      {/* A ruled list in columns, not a wrapped wall of pills. Thirty-one
          bubbles of differing widths have no alignment to read along, so
          finding one means scanning every bubble; alphabetical names in fixed
          columns can be read down. The × appears on hover so the resting state
          is just the list. */}
      <div className="mb-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        {sortedRoles.map(role => (
          <div key={role.id} className="group flex items-center justify-between gap-2 border-b border-line py-1.5">
            {editingId === role.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && renameRole(role.id)}
                onBlur={() => renameRole(role.id)}
                className={`${inputCls} py-1 px-2 text-xs`}
              />
            ) : (
              <button
                onClick={() => { setEditingId(role.id); setEditingName(role.name); setError('') }}
                className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:text-accent"
              >
                {role.name}
              </button>
            )}

            <button
              onClick={() => deleteRole(role.id)}
              disabled={busy}
              className="shrink-0 text-muted opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
              aria-label={`Delete ${role.name}`}
            >
              ×
            </button>
          </div>
        ))}
        {roles.length === 0 && <p className="text-sm text-muted">No roles yet.</p>}
      </div>

      {error && <p className="text-xs text-danger mb-3">{error}</p>}

      <div className="flex gap-2">
        <input
          placeholder="New role name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addRole()}
          className={`${inputCls} flex-1`}
        />
        <Button size="sm" onClick={addRole} disabled={busy || !newName.trim()}>Add</Button>
      </div>
    </div>
  )
}
