'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type AVRole = { id: string; name: string; sort_order: number }

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

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= roles.length) return
    const a = roles[index]
    const b = roles[target]
    setBusy(true)
    const { error } = await supabase.from('av_roles').update({ sort_order: b.sort_order }).eq('id', a.id)
    if (!error) await supabase.from('av_roles').update({ sort_order: a.sort_order }).eq('id', b.id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    const next = [...roles]
    ;[next[index], next[target]] = [{ ...b, sort_order: a.sort_order }, { ...a, sort_order: b.sort_order }]
    setRoles(next.sort((x, y) => x.sort_order - y.sort_order))
  }

  return (
    <div className="rounded-2xl bg-zinc-900 p-5 mb-6">
      <h2 className="text-lg font-bold text-white mb-1">AV Roles</h2>
      <p className="text-xs text-zinc-500 mb-4">Standard job titles available when staffing crew, shared across your organization.</p>

      <div className="flex flex-col gap-2 mb-4">
        {roles.map((role, i) => (
          <div key={role.id} className="flex items-center gap-2 rounded-lg bg-zinc-800/50 px-3 py-2">
            <div className="flex flex-col">
              <button onClick={() => move(i, -1)} disabled={i === 0 || busy} className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 leading-none text-xs">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === roles.length - 1 || busy} className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 leading-none text-xs">▼</button>
            </div>

            {editingId === role.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && renameRole(role.id)}
                onBlur={() => renameRole(role.id)}
                className="flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <button
                onClick={() => { setEditingId(role.id); setEditingName(role.name); setError('') }}
                className="flex-1 text-left text-sm text-white hover:text-blue-400"
              >
                {role.name}
              </button>
            )}

            <button
              onClick={() => deleteRole(role.id)}
              disabled={busy}
              className="text-zinc-500 hover:text-red-400 disabled:opacity-30"
              aria-label={`Delete ${role.name}`}
            >
              ×
            </button>
          </div>
        ))}
        {roles.length === 0 && <p className="text-sm text-zinc-500">No roles yet.</p>}
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      <div className="flex gap-2">
        <input
          placeholder="New role name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addRole()}
          className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={addRole}
          disabled={busy || !newName.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
