'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AddRoomModal({
  showId,
  currentWorkDayId,
  remainingWorkDayIds,
}: {
  showId: string
  currentWorkDayId: string
  remainingWorkDayIds: string[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [applyAll, setApplyAll] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function addRoom() {
    setError('')
    setLoading(true)

    const trimmedName = name.trim()
    const targetDayIds = applyAll
      ? [currentWorkDayId, ...remainingWorkDayIds]
      : [currentWorkDayId]

    // Skip any day that already has a room with this name (case-insensitive)
    // instead of silently creating a duplicate.
    const { data: existingRooms, error: lookupError } = await supabase
      .from('rooms')
      .select('work_day_id, name')
      .in('work_day_id', targetDayIds)

    if (lookupError) {
      setError(lookupError.message)
      setLoading(false)
      return
    }

    const conflictDayIds = new Set(
      (existingRooms || [])
        .filter(r => r.name.trim().toLowerCase() === trimmedName.toLowerCase())
        .map(r => r.work_day_id)
    )
    const insertDayIds = targetDayIds.filter(id => !conflictDayIds.has(id))

    if (insertDayIds.length === 0) {
      setError(`A room named "${trimmedName}" already exists on ${targetDayIds.length > 1 ? 'every selected day' : 'this day'}.`)
      setLoading(false)
      return
    }

    const rows = insertDayIds.map(workDayId => ({ work_day_id: workDayId, name: trimmedName }))
    const { error: insertError } = await supabase.from('rooms').insert(rows)

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
      return
    }

    setLoading(false)
    setOpen(false)
    setName('')
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
      >
        + Add Room
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-6 shadow-xl">
        <h2 className="text-lg font-bold text-white mb-4">Add Room</h2>
        <input
          placeholder="Room name (e.g. Plenary)"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500 mb-3"
        />
        {remainingWorkDayIds.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-400 mb-4">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={e => setApplyAll(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Add to all remaining days
          </label>
        )}
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={() => setOpen(false)}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            onClick={addRoom}
            disabled={loading || !name}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add Room'}
          </button>
        </div>
      </div>
    </div>
  )
}
