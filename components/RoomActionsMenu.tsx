'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

export default function RoomActionsMenu({
  roomId,
  roomName,
  crewCount,
}: {
  roomId: string
  roomName: string
  crewCount: number
}) {
  const router = useRouter()
  const supabase = createClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu')
  const [name, setName] = useState(roomName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function close() {
    setMenuOpen(false)
    setMode('menu')
    setName(roomName)
    setError('')
  }

  async function rename() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === roomName) {
      close()
      return
    }
    setLoading(true)
    setError('')
    const { error } = await supabase.from('rooms').update({ name: trimmed }).eq('id', roomId)
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    close()
    router.refresh()
  }

  async function deleteRoom() {
    setLoading(true)
    setError('')
    const { error } = await supabase.from('rooms').delete().eq('id', roomId)
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    close()
    router.refresh()
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(v => !v)}
        className="rounded-field px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink"
        aria-label="Room actions"
      >
        ⋮
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-card bg-surface border border-line p-3 shadow-xl">
          {mode === 'menu' && (
            <div className="flex flex-col gap-1">
              <button onClick={() => setMode('rename')} className="rounded-field px-3 py-2 text-left text-sm text-ink hover:bg-surface-2">
                Rename room
              </button>
              <button onClick={() => setMode('delete')} className="rounded-field px-3 py-2 text-left text-sm text-danger hover:bg-surface-2">
                Delete room
              </button>
              <button onClick={close} className="rounded-field px-3 py-2 text-left text-sm text-muted hover:bg-surface-2">
                Cancel
              </button>
            </div>
          )}

          {mode === 'rename' && (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && rename()}
                className="w-full rounded-field bg-surface-2 border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              {error && <p className="text-xs text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="flex-1" onClick={close}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={rename} disabled={loading || !name.trim()}>
                  {loading ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          )}

          {mode === 'delete' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink">
                Delete <span className="font-semibold">{roomName}</span>?
                {crewCount > 0 && (
                  <span className="block mt-1 text-danger">
                    This removes {crewCount} crew {crewCount === 1 ? 'entry' : 'entries'} and their punches for this day. This can&apos;t be undone.
                  </span>
                )}
              </p>
              {error && <p className="text-xs text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="flex-1" onClick={close}>Cancel</Button>
                <Button variant="danger" size="sm" className="flex-1" onClick={deleteRoom} disabled={loading}>
                  {loading ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
