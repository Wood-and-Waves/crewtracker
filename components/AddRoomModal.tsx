'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

export default function AddRoomModal({
  showId,
  currentWorkDayId,
  remainingWorkDayIds,
  allDays = false,
}: {
  showId: string
  currentWorkDayId: string
  remainingWorkDayIds: string[]
  /**
   * Add the room to EVERY day given, with no per-day choice offered.
   *
   * For Edit Show, which has no "current day" to be remaining from — it is the
   * whole show at once (Dan, 2026-10-02: "How do I add a room from the edit
   * show screen?", the answer having been that you could not). Offering the
   * tracker's checkbox there would ask about days the screen is not showing,
   * and unticking it would silently mean "day one only".
   *
   * The tracker keeps its per-day behaviour untouched: it IS looking at one
   * day, so "all remaining days" means something there.
   */
  allDays?: boolean
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
    const targetDayIds = allDays || applyAll
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
        className="rounded-field bg-accent-wash px-3 py-2 text-sm font-medium text-accent transition hover:opacity-80"
      >
        + Add Room
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm border-2 border-ink bg-surface p-6 shadow-edge">
        <h2 className="text-lg font-bold text-ink mb-4">Add Room</h2>
        <input
          placeholder="Room name (e.g. Plenary)"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent mb-3"
        />
        {!allDays && remainingWorkDayIds.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted mb-4">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={e => setApplyAll(e.target.checked)}
              className="h-4 w-4 rounded accent-accent"
            />
            Add to all remaining days
          </label>
        )}
        {error && <p className="text-xs text-danger mb-3">{error}</p>}
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1 py-3" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="flex-1 py-3" onClick={addRoom} disabled={loading || !name}>
            {loading ? 'Adding...' : 'Add Room'}
          </Button>
        </div>
      </div>
    </div>
  )
}
