'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import { formatPhone } from '@/lib/phone'

// Adding somebody to the crew directory, as a page.
//
// It was a dialog holding one field — a name — which inserted the row and then
// pushed you to the profile screen to do the actual work. Two screens, two
// saves, and a person already in the database before you had decided anything
// about them. This is the same shape as New Show being a page rather than a
// modal: fill the whole thing in, press Create once.
//
// Roles are collected LOCALLY and written after the crew_members insert
// succeeds, because rate_cards needs the new id as a foreign key.

type AVRole = { id: string; name: string }
type DraftRole = { role: string; rate: string }

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

const HEAD =
  'mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink'

export default function NewCrewMemberClient({
  organizationId,
  availableRoles,
  canEditRates = false,
}: {
  organizationId: string
  availableRoles: AVRole[]
  /** Gates the rate column, matching Edit Profile: adding a role is directory
   *  work, setting its rate is a pay decision. */
  canEditRates?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<DraftRole[]>([])
  const [roleName, setRoleName] = useState(availableRoles[0]?.name || '')
  const [roleRate, setRoleRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function addRole() {
    if (!roleName || roles.some(r => r.role === roleName)) return
    setRoles(prev => [...prev, { role: roleName, rate: roleRate }])
    setRoleRate('')
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')

    // Same duplicate guard the dialog had: a warning, not a block — two real
    // people genuinely do share a name.
    const { data: existing } = await supabase
      .from('crew_members')
      .select('full_name')
      .eq('organization_id', organizationId)
      .ilike('full_name', trimmed)
      .maybeSingle()

    if (existing && !confirm(`A crew member named "${existing.full_name}" already exists. Add another anyway?`)) {
      setBusy(false)
      return
    }

    const { data, error: insertError } = await supabase
      .from('crew_members')
      .insert({
        organization_id: organizationId,
        full_name: trimmed,
        phone: phone.trim() ? formatPhone(phone) : null,
        email: email.trim() || null,
      })
      .select('id')
      .single()

    if (insertError || !data) {
      setBusy(false)
      setError(insertError?.message || "Couldn't add this person.")
      return
    }

    if (roles.length > 0) {
      // day_rate is dropped by the database for a caller without
      // can_edit_pay_rates, so sending 0 is harmless either way.
      const { error: roleError } = await supabase.from('rate_cards').insert(
        roles.map(r => ({
          crew_member_id: data.id,
          role: r.role,
          day_rate: canEditRates ? parseFloat(r.rate) || 0 : 0,
        })),
      )
      if (roleError) {
        // The person exists; only their roles failed. Send them to the profile
        // rather than reporting a total failure that isn't true.
        setBusy(false)
        setError(`Added ${trimmed}, but their roles could not be saved: ${roleError.message}`)
        return
      }
    }

    router.push('/dashboard/directory')
    router.refresh()
  }

  return (
    <div className="max-w-2xl p-6 md:p-10">
      <Link href="/dashboard/directory" className="text-sm text-muted hover:text-ink">← Back to Directory</Link>
      <h1 className="mt-2 mb-6 font-display text-2xl font-bold uppercase tracking-wide">New Crew Member</h1>

      {error && (
        <div className="mb-4 border-l-[3px] border-danger py-1 pl-3 text-sm text-danger">{error}</div>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
        <section className="mb-6">
          <p className={HEAD}>Crew Info</p>
          <input
            autoFocus
            placeholder="Full name"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputCls}
          />
        </section>

        <section className="mb-6">
          <p className={HEAD}>Contact Info (Optional)</p>
          <input
            placeholder="Phone Number"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onBlur={() => setPhone(formatPhone(phone))}
            className={`${inputCls} mb-3`}
          />
          <input
            placeholder="Email Address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={inputCls}
          />
        </section>
      </div>

      <section className="mb-6">
        <p className={HEAD}>{canEditRates ? 'Roles & Rates' : 'Roles'}</p>

        {roles.length > 0 && (
          <div className="mb-3 border-b-[3px] border-ink">
            {roles.map(r => (
              <div key={r.role} className="flex items-center justify-between border-b border-line py-2.5 last:border-b-0">
                <span className="text-sm text-ink">{r.role}</span>
                <div className="flex items-center gap-3">
                  {canEditRates && r.rate && (
                    <span className="font-mono text-sm text-muted">${Math.round(parseFloat(r.rate) || 0)}</span>
                  )}
                  <button
                    onClick={() => setRoles(prev => prev.filter(x => x.role !== r.role))}
                    aria-label={`Remove ${r.role}`}
                    className="text-sm text-muted hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Select
            ariaLabel="Role"
            className="min-w-0 flex-1"
            value={roleName}
            onChange={setRoleName}
            options={availableRoles.map(r => ({ value: r.name, label: r.name }))}
          />
          {canEditRates && (
            <input
              placeholder="Day rate"
              type="number"
              value={roleRate}
              onChange={e => setRoleRate(e.target.value)}
              aria-label="Day rate"
              className="w-28 rounded-field border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
          )}
          <Button
            variant="ghost"
            onClick={addRole}
            disabled={!roleName || roles.some(r => r.role === roleName)}
          >
            Add
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Optional — roles can be added later from the profile. Nothing is saved until you press Create.
        </p>
      </section>

      <div className="flex gap-3">
        <Link href="/dashboard/directory" className="flex-1">
          <Button variant="ghost" className="w-full py-3">Cancel</Button>
        </Link>
        <Button className="flex-1 py-3" onClick={create} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  )
}
