'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

type RateCard = { id: string; role: string; day_rate: number }
type CrewMember = { id: string; full_name: string; phone: string | null; email: string | null; rate_cards: RateCard[] }
type AVRole = { id: string; name: string }

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function EditCrewMemberClient({
  crew,
  availableRoles,
}: {
  crew: CrewMember
  availableRoles: AVRole[]
}) {
  const supabase = createClient()

  const [name, setName] = useState(crew.full_name)
  const [phone, setPhone] = useState(crew.phone || '')
  const [email, setEmail] = useState(crew.email || '')
  const [rateCards, setRateCards] = useState<RateCard[]>(crew.rate_cards)

  const [editingCard, setEditingCard] = useState<RateCard | null>(null)
  const [editRate, setEditRate] = useState('')

  const [showAddRole, setShowAddRole] = useState(false)
  const [newRoleName, setNewRoleName] = useState(availableRoles[0]?.name || '')
  const [newRoleRate, setNewRoleRate] = useState('')

  async function saveField(field: 'full_name' | 'phone' | 'email', value: string) {
    await supabase.from('crew_members').update({ [field]: value || null }).eq('id', crew.id)
  }

  async function saveRate() {
    if (!editingCard) return
    const rate = parseFloat(editRate)
    if (isNaN(rate)) return
    await supabase.from('rate_cards').update({ day_rate: rate }).eq('id', editingCard.id)
    setRateCards(prev => prev.map(c => c.id === editingCard.id ? { ...c, day_rate: rate } : c))
    setEditingCard(null)
  }

  async function deleteRateCard(id: string) {
    if (!confirm('Delete this role?')) return
    await supabase.from('rate_cards').delete().eq('id', id)
    setRateCards(prev => prev.filter(c => c.id !== id))
  }

  async function addRole() {
    if (!newRoleName || rateCards.some(c => c.role === newRoleName)) return
    const rate = parseFloat(newRoleRate) || 0
    const { data } = await supabase
      .from('rate_cards')
      .insert({ crew_member_id: crew.id, role: newRoleName, day_rate: rate })
      .select()
      .single()
    if (data) setRateCards(prev => [...prev, data])
    setShowAddRole(false)
    setNewRoleRate('')
  }

  const alreadyHasNewRole = rateCards.some(c => c.role === newRoleName)

  return (
    <div className="p-6 md:p-10 max-w-2xl">
      <Link href="/dashboard/directory" className="text-sm text-muted hover:text-ink">← Back to Directory</Link>
      <h1 className="text-2xl font-bold mt-2 mb-6">Edit Profile</h1>

      <div className="lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-3">Crew Info</p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => saveField('full_name', name)}
            className={inputCls}
          />
        </Card>

        <Card className="p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-3">Contact Info (Optional)</p>
          <input
            placeholder="Phone Number"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onBlur={() => saveField('phone', phone)}
            className={`${inputCls} mb-3`}
          />
          <input
            placeholder="Email Address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onBlur={() => saveField('email', email)}
            className={inputCls}
          />
        </Card>
      </div>

      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted mb-3">Saved Roles &amp; Rates</p>
        <div className="flex flex-col gap-2 mb-4">
          {rateCards.map(card => (
            <div key={card.id} className="flex items-center justify-between rounded-field bg-surface-2 px-4 py-3">
              <button
                onClick={() => { setEditingCard(card); setEditRate(String(card.day_rate)) }}
                className="text-sm text-ink hover:text-accent"
              >
                {card.role}
              </button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted">${card.day_rate.toFixed(0)}</span>
                <button onClick={() => deleteRateCard(card.id)} className="text-muted hover:text-danger text-sm">✕</button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => { setNewRoleName(availableRoles[0]?.name || ''); setNewRoleRate(''); setShowAddRole(true) }}
          className="text-sm text-accent hover:opacity-80"
        >
          + Add Another Role...
        </button>
        <p className="text-xs text-muted mt-2">Tap a role to edit its day rate, or use the ✕ to remove it.</p>
      </Card>

      {editingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-1">Edit Day Rate</h2>
            <p className="text-sm text-muted mb-4">Enter a new day rate for {editingCard.role}.</p>
            <input
              type="number"
              value={editRate}
              onChange={e => setEditRate(e.target.value)}
              className={`${inputCls} mb-4`}
            />
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1 py-3" onClick={() => setEditingCard(null)}>Cancel</Button>
              <Button className="flex-1 py-3" onClick={saveRate}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {showAddRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-4">New Role</h2>
            <select
              key={availableRoles.map(r => r.id).join(',')}
              value={newRoleName}
              onChange={e => setNewRoleName(e.target.value)}
              className={`${inputCls} mb-3`}
            >
              {availableRoles.map(r => (
                <option key={r.id} value={r.name} className="bg-surface-2 text-ink">{r.name}</option>
              ))}
            </select>
            <input
              placeholder="Day Rate"
              type="number"
              value={newRoleRate}
              onChange={e => setNewRoleRate(e.target.value)}
              className={inputCls}
            />
            {alreadyHasNewRole && (
              <p className="text-xs text-ot mt-2">{newRoleName} is already saved for this person.</p>
            )}
            <div className="flex gap-3 mt-4">
              <Button variant="ghost" className="flex-1 py-3" onClick={() => setShowAddRole(false)}>Cancel</Button>
              <Button className="flex-1 py-3" onClick={addRole} disabled={!newRoleName || alreadyHasNewRole}>Add</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
