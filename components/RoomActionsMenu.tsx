'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
        className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        aria-label="Room actions"
      >
        ⋮
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl bg-zinc-800 p-3 shadow-xl">
          {mode === 'menu' && (
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setMode('rename')}
                className="rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700"
              >
                Rename room
              </button>
              <button
                onClick={() => setMode('delete')}
                className="rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-700"
              >
                Delete room
              </button>
              <button
                onClick={close}
                className="rounded-lg px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-700"
              >
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
                className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={close}
                  className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  Cancel
                </button>
                <button
                  onClick={rename}
                  disabled={loading || !name.trim()}
                  className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {mode === 'delete' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-300">
                Delete <span className="font-semibold text-white">{roomName}</span>?
                {crewCount > 0 && (
                  <span className="block mt-1 text-red-400">
                    This removes {crewCount} crew {crewCount === 1 ? 'entry' : 'entries'} and their punches for this day. This can't be undone.
                  </span>
                )}
              </p>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={close}
                  className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteRoom}
                  disabled={loading}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {loading ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
