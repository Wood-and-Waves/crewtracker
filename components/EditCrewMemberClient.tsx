'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type RateCard = { id: string; role: string; day_rate: number }
type CrewMember = { id: string; full_name: string; phone: string | null; email: string | null; rate_cards: RateCard[] }
type AVRole = { id: string; name: string }

export default function EditCrewMemberClient({
  crew,
  availableRoles,
}: {
  crew: CrewMember
  availableRoles: AVRole[]
}) {
  const router = useRouter()
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
    <div className="p-6 md:p-10 max-w-lg">
      <Link href="/dashboard/directory" className="text-sm text-zinc-500 hover:text-zinc-300">← Back to Directory</Link>
      <h1 className="text-2xl font-bold mt-2 mb-6">Edit Profile</h1>

      <div className="rounded-2xl bg-zinc-900 p-5 mb-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500 mb-3">Crew Info</p>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => saveField('full_name', name)}
          className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="rounded-2xl bg-zinc-900 p-5 mb-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500 mb-3">Contact Info (Optional)</p>
        <input
          placeholder="Phone Number"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          onBlur={() => saveField('phone', phone)}
          className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500 mb-3"
        />
        <input
          placeholder="Email Address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onBlur={() => saveField('email', email)}
          className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="rounded-2xl bg-zinc-900 p-5">
        <p className="text-xs uppercase tracking-wide text-zinc-500 mb-3">Saved Roles & Rates</p>
        <div className="flex flex-col gap-2 mb-4">
          {rateCards.map(card => (
            <div key={card.id} className="flex items-center justify-between rounded-lg bg-zinc-800/50 px-4 py-3">
              <button
                onClick={() => { setEditingCard(card); setEditRate(String(card.day_rate)) }}
                className="text-sm text-white hover:text-blue-400"
              >
                {card.role}
              </button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-400">${card.day_rate.toFixed(0)}</span>
                <button onClick={() => deleteRateCard(card.id)} className="text-zinc-600 hover:text-red-400 text-sm">✕</button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => { setNewRoleName(availableRoles[0]?.name || ''); setNewRoleRate(''); setShowAddRole(true) }}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          + Add Another Role...
        </button>
        <p className="text-xs text-zinc-600 mt-2">Tap a role to edit its day rate, or use the ✕ to remove it.</p>
      </div>

      {editingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold text-white mb-1">Edit Day Rate</h2>
            <p className="text-sm text-zinc-500 mb-4">Enter a new day rate for {editingCard.role}.</p>
            <input
              type="number"
              value={editRate}
              onChange={e => setEditRate(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setEditingCard(null)} className="flex-1 rounded-lg border border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-500">
                Cancel
              </button>
              <button onClick={saveRate} className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold text-white mb-4">New Role</h2>
            <select
              value={newRoleName}
              onChange={e => setNewRoleName(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            >
              {availableRoles.map(r => (
                <option key={r.id} value={r.name} className="bg-zinc-800 text-white">{r.name}</option>
              ))}
            </select>
            <input
              placeholder="Day Rate"
              type="number"
              value={newRoleRate}
              onChange={e => setNewRoleRate(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500"
            />
            {alreadyHasNewRole && (
              <p className="text-xs text-orange-400 mt-2">{newRoleName} is already saved for this person.</p>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowAddRole(false)} className="flex-1 rounded-lg border border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-500">
                Cancel
              </button>
              <button
                onClick={addRole}
                disabled={!newRoleName || alreadyHasNewRole}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
