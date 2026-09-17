'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import { SHOW_WIDE_ROOM_NAME } from '@/lib/showWideRoom'

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
  // "Not a room at all — the whole show." A PM often works the show rather than
  // a space, and hours have to hang off a room, so the whole show IS one,
  // flagged (0041). It lives in this modal because this is already where you go
  // to make somewhere for a person to stand, and because it wants the same
  // "all remaining days" behaviour — a PM is on every day of the run.
  const [wholeShow, setWholeShow] = useState(false)
  const [applyAll, setApplyAll] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function addRoom() {
    setError('')
    setLoading(true)

    const trimmedName = wholeShow ? SHOW_WIDE_ROOM_NAME : name.trim()
    const targetDayIds = applyAll
      ? [currentWorkDayId, ...remainingWorkDayIds]
      : [currentWorkDayId]

    // Skip any day that already has this room instead of silently creating a
    // duplicate: by name for a real room, by the FLAG for the whole show —
    // there is one of those per day and the database refuses a second, so
    // matching on the name would let a renamed one through to a 23505.
    const { data: existingRooms, error: lookupError } = await supabase
      .from('rooms')
      .select('work_day_id, name, is_show_wide')
      .in('work_day_id', targetDayIds)

    if (lookupError) {
      setError(lookupError.message)
      setLoading(false)
      return
    }

    const conflictDayIds = new Set(
      (existingRooms || [])
        .filter(r => wholeShow
          ? r.is_show_wide === true
          : r.name.trim().toLowerCase() === trimmedName.toLowerCase())
        .map(r => r.work_day_id)
    )
    const insertDayIds = targetDayIds.filter(id => !conflictDayIds.has(id))

    if (insertDayIds.length === 0) {
      const where = targetDayIds.length > 1 ? 'every selected day' : 'this day'
      setError(wholeShow
        ? `The whole show is already a place on ${where}.`
        : `A room named "${trimmedName}" already exists on ${where}.`)
      setLoading(false)
      return
    }

    const rows = insertDayIds.map(workDayId => ({
      work_day_id: workDayId, name: trimmedName, is_show_wide: wholeShow,
    }))
    const { error: insertError } = await supabase.from('rooms').insert(rows)

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
      return
    }

    setLoading(false)
    setOpen(false)
    setName('')
    setWholeShow(false)
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
        <h2 className="text-lg font-bold text-ink mb-4">{wholeShow ? 'Add the Whole Show' : 'Add Room'}</h2>
        {wholeShow ? (
          <p className="mb-3 text-sm text-muted">
            For somebody who works the show rather than a space — a production manager, a
            producer. They punch and get paid like anybody else; they are just not in a room.
          </p>
        ) : (
          <input
            placeholder="Room name (e.g. Plenary)"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent mb-3"
          />
        )}
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={wholeShow}
            onChange={e => { setWholeShow(e.target.checked); setError('') }}
            className="h-4 w-4 rounded accent-accent"
          />
          Not a room — the whole show
        </label>
        {remainingWorkDayIds.length > 0 && (
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
          <Button className="flex-1 py-3" onClick={addRoom} disabled={loading || (!wholeShow && !name)}>
            {loading ? 'Adding...' : wholeShow ? 'Add Whole Show' : 'Add Room'}
          </Button>
        </div>
      </div>
    </div>
  )
}
