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
  organizationId,
  pm,
  onPick,
  disabled = false,
}: {
  /** Present on Edit Show: choices are sent straight away. Absent on New Show. */
  showId?: string
  /** WHOSE members to offer. Without it the list is every membership the caller
   *  can read, and the memberships policy lets somebody see their OWN rows in
   *  every company they belong to — so anyone in two companies appeared twice
   *  (Dan, 2026-09-16: "Why do I (Dan Smith) show up twice in production
   *  managers?"). Both entries carried the same profile, so it picked the right
   *  person either way; it just could not be read. */
  organizationId?: string
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
    const q = supabase
      .from('memberships')
      .select('profile_id, profiles(full_name, email)')
      .is('deactivated_at', null)
      // PEOPLE WHO COULD ACTUALLY RUN THE SHOW. Every login in the company was
      // offered until 2026-09-16, including crew-only ones and read-only office
      // staff (Dan: "Sasha is not a PM, Meredith is not a PM, Alex is not a
      // PM. Why would they be on the list?"). Naming one of those invites them,
      // grants them the show when they accept, and leaves them unable to touch
      // a punch on it.
      //
      // The gate is can_edit_timecards, NOT the `pm` base_role — which is the
      // tempting version and the wrong one. base_role is a preset of
      // permissions, not a badge: an owner-operator is `admin` and is the PM on
      // most of their own shows, so filtering on the preset would remove the
      // commonest PM of all. And PM is a job on ONE SHOW rather than a person's
      // title — the same person PMs on Tuesday and is the A1 on Thursday, which
      // is why the field lives on the show.
      .eq('can_edit_timecards', true)
    if (organizationId) q.eq('organization_id', organizationId)
    q
      .then(({ data }) => {
        if (!active) return
        const rows = (data ?? []).map((m: any) => {
          const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
          return { id: m.profile_id as string, name: (p?.full_name || p?.email || 'Unnamed') as string }
        })
        // Belt as well as braces: the filter above is the fix, and this makes
        // one person one entry whatever the query returns.
        const seen = new Set<string>()
        setMembers(rows
          .filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
          .sort((a, b) => a.name.localeCompare(b.name)))
      })
    return () => { active = false }
  }, [organizationId])

  // WHOEVER ALREADY HOLDS THE SHOW STAYS ON THE LIST, even if they would not be
  // offered today — somebody named before the filter existed, or since moved to
  // a role that cannot run a show. Dropping them would blank the field on a
  // show that plainly has a PM, and make the fix look like data loss.
  const listed = new Set(members.map(m => m.id))
  const held = pm.profileId && !listed.has(pm.profileId)
    ? [{ id: pm.profileId, name: pm.name ?? 'Current PM' }]
    : []
  const choices = [...held, ...members]
  const options = [{ value: '', label: 'Not assigned yet' }, ...choices.map(m => ({ value: m.id, label: m.name }))]
  const nameOf = (id: string) => choices.find(m => m.id === id)?.name ?? 'them'

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

  // They said yes on the phone. The same act as recording a crew member's
  // answer, and the same wording is used on the Scheduling screen's PM chip:
  // it grants the show, so it says so.
  async function recordAccepted() {
    if (!pm.profileId) return
    if (!confirm(`Record that ${pm.name ?? 'they'} accepted? This opens the show to them, the same as if they had pressed Accept in their email.`)) return
    const ok = await post({ profileId: pm.profileId, markAccepted: true })
    if (!ok) return
    setNotice(`${pm.name ?? 'They'} now has this show.`)
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
                <button type="button" className="font-semibold text-accent hover:underline disabled:opacity-40" disabled={busy || disabled} onClick={recordAccepted}>They accepted</button>
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
