'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'
import Select from '@/components/ui/Select'

// The production manager on a show (piece B of the 2026-09-07 show-flow spec).
//
// Naming somebody is an INVITATION, not a grant. They get an email; the show
// reaches their CrewTracker only when they press Accept on it. Dan: a silent
// accept is dangerous. So every choice here is confirmed in words that say
// exactly that, and the field reads back where things stand — invited and
// waiting, or accepted.
//
// Two homes. On NEW SHOW the show does not exist yet, so the field only
// records a choice (onPick) and the create path sends the invitation once the
// show is real. On EDIT SHOW (showId given) a choice is confirmed and sent at
// once through /api/pm/invite, and the field also offers Resend.
//
// Members are loaded here rather than passed in, so neither page grows a
// prop for a list that is only needed when somebody opens this field.

export type PmState = {
  profileId: string | null
  name: string | null
  invitedAt: string | null
  acceptedAt: string | null
}

type Member = { id: string; name: string }

function fmt(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function PmField({
  showId,
  pm,
  onPick,
  disabled = false,
}: {
  /** Present on Edit Show: choices are sent straight away. Absent on New Show. */
  showId?: string
  pm: PmState
  /** New Show only: the choice, for the create path to act on. */
  onPick?: (member: Member | null) => void
  disabled?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [members, setMembers] = useState<Member[]>([])
  const [pending, setPending] = useState<string | null>(null)   // '' = remove
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    supabase
      .from('memberships')
      .select('profile_id, profiles(full_name, email)')
      .is('deactivated_at', null)
      .then(({ data }) => {
        if (!active) return
        const rows = (data ?? []).map((m: any) => {
          const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
          return { id: m.profile_id as string, name: (p?.full_name || p?.email || 'Unnamed') as string }
        })
        setMembers(rows.sort((a, b) => a.name.localeCompare(b.name)))
      })
    return () => { active = false }
  }, [])

  const options = [{ value: '', label: 'Not assigned yet' }, ...members.map(m => ({ value: m.id, label: m.name }))]
  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? 'them'

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('')
    const res = await fetch('/api/pm/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showId, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(data.error || 'That did not save.'); return false }
    if (data.warning) setNotice(data.warning)
    return true
  }

  async function confirmPending() {
    if (pending === null) return
    const ok = await post({ profileId: pending || null })
    if (!ok) return
    if (pending && !notice) setNotice(`Invitation sent to ${nameOf(pending)}.`)
    setPending(null)
    router.refresh()
  }

  async function resend() {
    if (!pm.profileId) return
    const ok = await post({ profileId: pm.profileId, resend: true })
    if (ok && !notice) setNotice('Sent again.')
    router.refresh()
  }

  const current = pm.profileId ?? ''
  const selected = pending ?? current

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          ariaLabel="Production manager"
          className="min-w-[220px]"
          value={selected}
          disabled={disabled || busy}
          options={options}
          onChange={v => {
            if (showId) { setPending(v === current ? null : v); setError(''); setNotice('') }
            else onPick?.(v ? { id: v, name: nameOf(v) } : null)
          }}
        />
        {showId && pm.profileId && pending === null && (
          pm.acceptedAt
            ? <span className="flex items-center gap-1.5 text-xs text-muted"><Chip tone="good">Accepted</Chip>{fmt(pm.acceptedAt)}</span>
            : <span className="flex items-center gap-1.5 text-xs text-muted">
                <Chip tone="neutral">Invited</Chip>
                {pm.invitedAt ? `${fmt(pm.invitedAt)}, waiting` : 'waiting'}
                <button type="button" className="font-semibold text-accent hover:underline disabled:opacity-40" disabled={busy || disabled} onClick={resend}>Resend</button>
              </span>
        )}
      </div>

      {!showId && (
        <p className="mt-1.5 text-xs text-muted">
          {selected
            ? `${nameOf(selected)} gets an email when the show is created, and the show once they accept.`
            : 'Optional. They get an email, and the show once they accept.'}
        </p>
      )}

      {showId && pending !== null && (
        <div className="mt-2 border-l-[3px] border-accent py-1 pl-3">
          <p className="text-sm text-ink">
            {pending
              ? `Invite ${nameOf(pending)} as PM? They'll get an email and the show once they accept.`
              : `Remove ${pm.name ?? 'the PM'}? They lose the show unless they were given access by hand.`}
            {pending && pm.profileId ? ` ${pm.name ?? 'The current PM'} loses it.` : ''}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy} onClick={confirmPending}>{busy ? 'Sending…' : pending ? 'Send invitation' : 'Remove'}</Button>
            <button type="button" className="text-xs text-muted hover:text-ink" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}

      {notice && <p className="mt-2 text-xs text-muted">{notice}</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
