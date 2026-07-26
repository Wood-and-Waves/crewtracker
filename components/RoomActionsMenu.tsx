'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

type RoomCrew = { id: string; crewMemberId: string | null; name: string; role: string; dayRate: number }

export default function RoomActionsMenu({
  roomId,
  roomName,
  crewCount,
  crew = [],
  canViewRates = false,
  canEditRates = false,
}: {
  roomId: string
  roomName: string
  crewCount: number
  crew?: RoomCrew[]
  canViewRates?: boolean
  canEditRates?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete' | 'editCrew'>('menu')
  const [name, setName] = useState(roomName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [crewList, setCrewList] = useState<RoomCrew[]>(crew)
  const [rateInputs, setRateInputs] = useState<Record<string, string>>({})
  const [roles, setRoles] = useState<string[]>([])

  // Load the org's AV roles for the role dropdown when Edit Crew opens.
  useEffect(() => {
    if (mode !== 'editCrew') return
    let active = true
    supabase.from('av_roles').select('name').order('sort_order').then(({ data }) => {
      if (active) setRoles((data || []).map(r => r.name))
    })
    return () => { active = false }
  }, [mode])

  function close() {
    setMenuOpen(false)
    setMode('menu')
    setName(roomName)
    setError('')
    setCrewList(crew)
  }

  function startEditCrew() {
    setCrewList(crew)
    setRateInputs(Object.fromEntries(crew.map(c => [c.id, String(c.dayRate ?? 0)])))
    setMenuOpen(false)
    setError('')
    setMode('editCrew')
  }

  async function updateRole(tc: RoomCrew, newRole: string) {
    setCrewList(prev => prev.map(c => c.id === tc.id ? { ...c, role: newRole } : c))
    const { error } = await supabase.from('timecards').update({ role: newRole }).eq('id', tc.id)
    if (error) { setError(error.message); return }
    router.refresh()
  }

  async function saveRate(tc: RoomCrew) {
    const rate = parseFloat(rateInputs[tc.id]) || 0
    if (rate === tc.dayRate) return
    setCrewList(prev => prev.map(c => c.id === tc.id ? { ...c, dayRate: rate } : c))
    const { error } = await supabase.from('timecards').update({ day_rate: rate }).eq('id', tc.id)
    if (error) { setError(error.message); return }
    router.refresh()
  }

  async function removeCrew(tc: RoomCrew) {
    if (!confirm(`Remove ${tc.name} from ${roomName}? This deletes their punches for this day.`)) return
    setLoading(true)
    setError('')
    const { error } = await supabase.from('timecards').delete().eq('id', tc.id)
    setLoading(false)
    if (error) { setError(error.message); return }
    setCrewList(prev => prev.filter(c => c.id !== tc.id))
    router.refresh()
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
              <button onClick={startEditCrew} className="rounded-field px-3 py-2 text-left text-sm text-ink hover:bg-surface-2">
                Edit crew
              </button>
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

      {mode === 'editCrew' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-card bg-surface border border-line shadow-xl">
            <div className="p-5 pb-3 border-b border-line">
              <h2 className="text-lg font-bold text-ink">Edit Crew — {roomName}</h2>
              {canViewRates && canEditRates && (
                // A day rate belongs to the show, not the day: the database
                // propagates any change to every day this person works this
                // show in this role. Said plainly here so the PM isn't
                // surprised by an edit reaching beyond the day they're on.
                <p className="mt-1 text-xs text-muted">
                  Day rates apply to the whole show — changing one updates every day.
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 pt-4 flex flex-col gap-3">
              {crewList.length === 0 && <p className="text-sm text-muted">No crew in this room.</p>}
              {crewList.map(tc => {
                const roleOptions = Array.from(new Set([...(tc.role ? [tc.role] : []), ...roles]))
                return (
                  <div key={tc.id} className="rounded-field bg-surface-2 p-3">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{tc.name}</p>
                      <button
                        onClick={() => removeCrew(tc)}
                        disabled={loading}
                        aria-label={`Remove ${tc.name}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-danger disabled:opacity-50"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
                        </svg>
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <select
                        key={roleOptions.join(',')}
                        value={tc.role}
                        onChange={e => updateRole(tc, e.target.value)}
                        className="flex-1 rounded-field bg-surface-3 border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      >
                        {roleOptions.length === 0 && <option value="" className="bg-surface-2 text-ink">No role</option>}
                        {roleOptions.map(r => (
                          <option key={r} value={r} className="bg-surface-2 text-ink">{r}</option>
                        ))}
                      </select>
                      {canViewRates && (
                        canEditRates ? (
                          <input
                            type="number"
                            inputMode="decimal"
                            value={rateInputs[tc.id] ?? ''}
                            onChange={e => setRateInputs(prev => ({ ...prev, [tc.id]: e.target.value }))}
                            onBlur={() => saveRate(tc)}
                            aria-label={`Day rate for ${tc.name}`}
                            className="w-24 rounded-field bg-surface-3 border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                          />
                        ) : (
                          <div className="w-24 rounded-field bg-surface-3 border border-line px-3 py-2 text-sm text-muted tabular-nums">
                            ${tc.dayRate.toFixed(0)}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="p-5 pt-3 border-t border-line">
              {error && <p className="text-xs text-danger mb-2">{error}</p>}
              <Button variant="ghost" className="w-full py-3" onClick={close}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
