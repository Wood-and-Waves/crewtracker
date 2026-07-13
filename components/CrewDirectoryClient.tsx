'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type RateCard = { id: string; role: string; day_rate: number }
type CrewMember = { id: string; full_name: string; phone: string | null; email: string | null; rate_cards: RateCard[] }

type SortOption = 'firstName' | 'lastName' | 'role'

function firstNameOf(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName
}
function lastNameOf(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : fullName
}
function formatForDisplay(fullName: string, sort: SortOption) {
  if (sort !== 'lastName') return fullName
  const parts = fullName.trim().split(/\s+/)
  if (parts.length < 2) return fullName
  const last = parts[parts.length - 1]
  const rest = parts.slice(0, -1).join(' ')
  return `${last}, ${rest}`
}

function csvField(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

export default function CrewDirectoryClient({
  organizationId,
  initialCrew,
}: {
  organizationId: string
  initialCrew: CrewMember[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [crew, setCrew] = useState<CrewMember[]>(initialCrew)
  const [sort, setSort] = useState<SortOption>('lastName')
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [importing, setImporting] = useState(false)

  const sorted = [...crew].sort((a, b) => {
    if (sort === 'firstName') {
      return firstNameOf(a.full_name).localeCompare(firstNameOf(b.full_name))
    }
    if (sort === 'lastName') {
      const la = lastNameOf(a.full_name), lb = lastNameOf(b.full_name)
      if (la === lb) return a.full_name.localeCompare(b.full_name)
      return la.localeCompare(lb)
    }
    const ra = a.rate_cards[0]?.role || 'ZZZ'
    const rb = b.rate_cards[0]?.role || 'ZZZ'
    if (ra === rb) return a.full_name.localeCompare(b.full_name)
    return ra.localeCompare(rb)
  })

  async function addPerson() {
    const trimmed = newName.trim()
    if (!trimmed) return
    const { data, error } = await supabase
      .from('crew_members')
      .insert({ organization_id: organizationId, full_name: trimmed })
      .select()
      .single()
    if (error || !data) return
    setShowAdd(false)
    setNewName('')
    router.push(`/dashboard/directory/${data.id}`)
  }

  async function deleteCrew(id: string) {
    if (!confirm('Delete this crew member? This cannot be undone.')) return
    const { error } = await supabase.from('crew_members').delete().eq('id', id)
    if (!error) setCrew(prev => prev.filter(c => c.id !== id))
  }

  function exportCSV() {
    const rows = ['Name,Role,Day Rate,Phone,Email']
    for (const person of [...crew].sort((a, b) => a.full_name.localeCompare(b.full_name))) {
      if (person.rate_cards.length === 0) {
        rows.push([csvField(person.full_name), csvField(''), csvField(''), csvField(person.phone || ''), csvField(person.email || '')].join(','))
      } else {
        for (const card of person.rate_cards) {
          rows.push([
            csvField(person.full_name),
            csvField(card.role),
            csvField(card.day_rate > 0 ? String(card.day_rate) : ''),
            csvField(person.phone || ''),
            csvField(person.email || ''),
          ].join(','))
        }
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Master_Crew_Directory.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadTemplate() {
    const csv = 'Name,Role,Day Rate,Phone,Email\nJohn Doe,A1,650,555-0100,john@example.com\nJane Smith,Camera Operator,500,,\nMike Johnson,Stagehand,350,555-0102,'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'CrewTracker_Template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(file: File) {
    setImporting(true)
    setImportStatus('')
    const text = await file.text()
    const rows = text.split(/\r?\n/).map(r => r.trim()).filter(r => r.length > 0)

    const crewCache: Record<string, CrewMember> = {}
    for (const c of crew) crewCache[c.full_name.toLowerCase()] = c

    let newCount = 0
    let updatedCount = 0

    for (let i = 0; i < rows.length; i++) {
      const cols = rows[i].split(',').map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
      while (cols.length < 5) cols.push('')

      if (i === 0 && (cols[0].toLowerCase() === 'name' || cols[0].toLowerCase() === 'crew')) continue

      const name = cols[0]
      if (!name) continue
      const role = cols[1]
      const rate = parseFloat(cols[2].replace('$', '')) || 0
      const phone = cols[3]
      const email = cols[4]

      const lowerName = name.toLowerCase()
      let member = crewCache[lowerName]

      if (member) {
        updatedCount += 1
        const updates: any = {}
        if (phone) updates.phone = phone
        if (email) updates.email = email
        if (Object.keys(updates).length > 0) {
          await supabase.from('crew_members').update(updates).eq('id', member.id)
        }
      } else {
        const { data } = await supabase
          .from('crew_members')
          .insert({ organization_id: organizationId, full_name: name, phone: phone || null, email: email || null })
          .select('*, rate_cards(*)')
          .single()
        if (data) {
          member = data
          crewCache[lowerName] = member
          newCount += 1
        }
      }

      if (role && member) {
        const hasRole = member.rate_cards.some(rc => rc.role.toLowerCase() === role.toLowerCase())
        if (!hasRole) {
          await supabase.from('rate_cards').insert({ crew_member_id: member.id, role, day_rate: rate })
        }
      }
    }

    setImporting(false)
    const parts: string[] = []
    if (newCount > 0) parts.push(`${newCount} new crew member${newCount === 1 ? '' : 's'} added`)
    if (updatedCount > 0) parts.push(`${updatedCount} existing record${updatedCount === 1 ? '' : 's'} updated`)
    setImportStatus(parts.length === 0 ? 'No changes made.' : parts.join(', ') + '.')
    router.refresh()

    const { data: refreshed } = await supabase
      .from('crew_members')
      .select('*, rate_cards(*)')
      .eq('organization_id', organizationId)
    if (refreshed) setCrew(refreshed)
  }

  return (
    <div className="p-6 md:p-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Crew Directory</h1>
        <div className="flex items-center gap-2">
          {crew.length > 0 && (
            <button onClick={exportCSV} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
              Export CSV
            </button>
          )}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortOption)}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300 outline-none"
          >
            <option value="lastName" className="bg-zinc-800 text-white">Sort: Last Name</option>
            <option value="firstName" className="bg-zinc-800 text-white">Sort: First Name</option>
            <option value="role" className="bg-zinc-800 text-white">Sort: Role</option>
          </select>
          <button onClick={() => setShowImport(true)} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
            Import
          </button>
          <button onClick={() => setShowAdd(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
            + Add Person
          </button>
        </div>
      </div>

      {crew.length === 0 ? (
        <p className="text-zinc-500">Directory empty. Add your freelance crew here so you can assign them to shows.</p>
      ) : (
        <div className="rounded-2xl bg-zinc-900 divide-y divide-zinc-800">
          {sorted.map(person => (
            <div key={person.id} className="flex items-center justify-between p-4">
              <button
                onClick={() => router.push(`/dashboard/directory/${person.id}`)}
                className="flex-1 text-left"
              >
                <p className="text-sm font-medium text-white">{formatForDisplay(person.full_name, sort)}</p>
                <p className="text-xs text-zinc-500">
                  {person.rate_cards.length > 0 ? person.rate_cards.map(rc => rc.role).join(', ') : 'No roles assigned'}
                </p>
              </button>
              <div className="flex items-center gap-3">
                {person.phone && (
                  <>
                    <a href={`tel:${person.phone}`} className="text-blue-400 hover:text-blue-300" title="Call">☎</a>
                    <a href={`sms:${person.phone}`} className="text-blue-400 hover:text-blue-300" title="Text">✉</a>
                  </>
                )}
                {person.email && (
                  <a href={`mailto:${person.email}`} className="text-blue-400 hover:text-blue-300" title="Email">✉️</a>
                )}
                <button onClick={() => deleteCrew(person.id)} className="text-zinc-600 hover:text-red-400 text-sm" title="Delete">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold text-white mb-4">Add Person</h2>
            <input
              placeholder="Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPerson()}
              className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowAdd(false); setNewName('') }} className="flex-1 rounded-lg border border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-500">
                Cancel
              </button>
              <button onClick={addPerson} disabled={!newName.trim()} className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Import Roster</h2>
              <button onClick={() => { setShowImport(false); setImportStatus('') }} className="text-zinc-500 hover:text-zinc-300">Close</button>
            </div>
            <p className="text-sm text-zinc-400 mb-2">Upload a .csv with columns in this order:</p>
            <p className="text-xs text-zinc-500 mb-4">Name, Role, Day Rate, Phone, Email — no dollar signs. Phone and Email are optional.</p>
            <button onClick={downloadTemplate} className="text-sm text-blue-400 hover:text-blue-300 mb-4 block">
              Download example template
            </button>
            <input
              type="file"
              accept=".csv"
              onChange={e => e.target.files?.[0] && handleImportFile(e.target.files[0])}
              disabled={importing}
              className="w-full text-sm text-zinc-300"
            />
            {importing && <p className="text-sm text-zinc-500 mt-3">Importing...</p>}
            {importStatus && <p className="text-sm text-zinc-300 mt-3">{importStatus}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
