'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

type CrewMember = { id: string; full_name: string }
type RateCard = { crew_member_id: string; role: string; day_rate: number }

const inputCls =
  'rounded-field bg-surface-2 border border-line px-3 py-2 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function StaffRoomModal({
  organizationId,
  roomId,
  roomName,
  currentWorkDayId,
  remainingRoomIdsSameName,
}: {
  organizationId: string
  roomId: string
  roomName: string
  currentWorkDayId: string
  remainingRoomIdsSameName: string[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [selected, setSelected] = useState<Record<string, { role: string; dayRate: string }>>({})
  const [applyAll, setApplyAll] = useState(true)
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    async function load() {
      const { data: crewData } = await supabase
        .from('crew_members')
        .select('id, full_name')
        .eq('organization_id', organizationId)
        .order('full_name')
      setCrew(crewData || [])

      const { data: rateData } = await supabase
        .from('rate_cards')
        .select('crew_member_id, role, day_rate')
      setRateCards(rateData || [])
    }
    load()
  }, [open])

  function toggleCrew(id: string) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[id]) {
        delete next[id]
      } else {
        const existingRate = rateCards.find(rc => rc.crew_member_id === id)
        next[id] = {
          role: existingRate?.role || '',
          dayRate: existingRate ? String(existingRate.day_rate) : '',
        }
      }
      return next
    })
  }

  function updateField(id: string, field: 'role' | 'dayRate', value: string) {
    setSelected(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  async function addCrewMember() {
    if (!newName.trim()) return
    const { data, error: insertError } = await supabase
      .from('crew_members')
      .insert({ organization_id: organizationId, full_name: newName.trim() })
      .select()
      .single()

    if (insertError || !data) {
      setError(insertError?.message || 'Failed to add crew member')
      return
    }

    setCrew(prev => [...prev, data].sort((a, b) => a.full_name.localeCompare(b.full_name)))
    setNewName('')
  }

  async function submit() {
    setError('')
    setLoading(true)

    const roomIds = applyAll ? [roomId, ...remainingRoomIdsSameName] : [roomId]
    const timecardRows: any[] = []
    const rateCardUpserts: any[] = []

    for (const [crewId, info] of Object.entries(selected)) {
      const member = crew.find(c => c.id === crewId)
      if (!member) continue
      const dayRate = parseFloat(info.dayRate) || 0

      for (const rId of roomIds) {
        timecardRows.push({
          room_id: rId,
          crew_member_id: crewId,
          crew_member_name: member.full_name,
          role: info.role,
          day_rate: dayRate,
        })
      }

      if (info.role) {
        rateCardUpserts.push({ crew_member_id: crewId, role: info.role, day_rate: dayRate })
      }
    }

    if (timecardRows.length === 0) {
      setError('Select at least one crew member')
      setLoading(false)
      return
    }

    const { error: tcError } = await supabase.from('timecards').insert(timecardRows)
    if (tcError) {
      setError(tcError.message)
      setLoading(false)
      return
    }

    for (const rc of rateCardUpserts) {
      await supabase
        .from('rate_cards')
        .upsert(rc, { onConflict: 'crew_member_id,role' })
    }

    setLoading(false)
    setOpen(false)
    setSelected({})
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-field bg-accent-wash px-3 py-2 text-sm font-medium text-accent transition hover:opacity-80"
      >
        + Staff Crew
      </button>
    )
  }

  const selectedCount = Object.keys(selected).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-card bg-surface border border-line shadow-xl">
        <div className="p-6 pb-4 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Staff {roomName}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pt-4">
          <div className="flex gap-2 mb-4">
            <input
              placeholder="Quick add crew member name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCrewMember()}
              className={`${inputCls} flex-1`}
            />
            <Button variant="ghost" size="sm" onClick={addCrewMember}>Add</Button>
          </div>

          <div className="flex flex-col gap-2">
            {crew.length === 0 && (
              <p className="text-sm text-muted">No crew members yet. Add one above.</p>
            )}
            {crew.map(member => {
              const isSelected = !!selected[member.id]
              return (
                <div key={member.id} className="rounded-field bg-surface-2 p-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleCrew(member.id)}
                      className="h-4 w-4 rounded accent-accent"
                    />
                    <span className="text-sm text-ink">{member.full_name}</span>
                  </label>
                  {isSelected && (
                    <div className="mt-2 flex gap-2 pl-7">
                      <input
                        placeholder="Role"
                        value={selected[member.id].role}
                        onChange={e => updateField(member.id, 'role', e.target.value)}
                        className={`${inputCls} flex-1 text-xs`}
                      />
                      <input
                        placeholder="Day rate"
                        type="number"
                        value={selected[member.id].dayRate}
                        onChange={e => updateField(member.id, 'dayRate', e.target.value)}
                        className={`${inputCls} w-28 text-xs`}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="p-6 pt-4 border-t border-line">
          {remainingRoomIdsSameName.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted mb-3">
              <input
                type="checkbox"
                checked={applyAll}
                onChange={e => setApplyAll(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              Apply to all remaining days for this room
            </label>
          )}
          {error && <p className="text-xs text-danger mb-3">{error}</p>}
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1 py-3" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="flex-1 py-3" onClick={submit} disabled={loading || selectedCount === 0}>
              {loading ? 'Staffing...' : `Staff ${selectedCount || ''} Crew`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
