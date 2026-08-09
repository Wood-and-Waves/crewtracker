'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'

// The platform-operator view.
//
// Two things shape it:
//
// 1. It shows ORGANIZATIONS, not people. The previous version listed every
//    profile on the platform — name, email, org, role — which is the customer's
//    member directory, not the operator's business. Seat counts convey the same
//    operational signal without the names.
//
// 2. Pending invitations ARE shown, addresses included, because Dan needs them
//    for support ("my invite isn't working"). That's a deliberate, narrower
//    exception to the same rule: a pending invite is an address someone typed
//    to send an invitation, not a directory of who works there.

export type OrgRow = {
  id: string
  name: string
  created_at: string
  disabled_at: string | null
  /** The scheduling module — positions, booking requests, the calendar. */
  schedulingEnabled: boolean
  plan: string | null
  status: string | null
  trialEndsAt: string | null
  members: number
  shows: number
}

export type InviteRow = {
  id: string
  email: string | null
  orgLabel: string
  isNewOrg: boolean
  expires_at: string
  expired: boolean
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function SuperAdminClient({
  orgs,
  invites,
}: {
  orgs: OrgRow[]
  invites: InviteRow[]
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  async function setOrgStatus(org: OrgRow, suspend: boolean) {
    const verb = suspend ? 'Suspend' : 'Re-enable'
    if (!confirm(
      `${verb} ${org.name}?\n\n` +
      (suspend
        ? 'Everyone in this organization will be signed out of the app until it is re-enabled. Their shows and payroll records are not touched.'
        : 'Members will be able to use CrewTracker again immediately.')
    )) return

    setBusyId(org.id); setError('')
    const res = await fetch('/api/admin/org-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: org.id, suspend }),
    })
    setBusyId(null)
    if (!res.ok) { setError((await res.json()).error || 'Could not update the organization.'); return }
    router.refresh()
  }

  // Switching the module off hides it; it deletes nothing. Anything already
  // built stays in the database and comes back intact if it is switched on
  // again — worth saying in the confirm, because "turn off scheduling" sounds
  // destructive and isn't.
  async function setScheduling(org: OrgRow, enabled: boolean) {
    if (!confirm(
      `${enabled ? 'Enable' : 'Disable'} scheduling for ${org.name}?\n\n` +
      (enabled
        ? 'Positions, crew booking requests and the company calendar become available to members who have the scheduling permission.'
        : 'The scheduling screens are hidden. Nothing is deleted — any positions and booking history are kept, and come back if you switch it on again.')
    )) return

    setBusyId(org.id); setError('')
    const res = await fetch('/api/admin/org-scheduling', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: org.id, enabled }),
    })
    setBusyId(null)
    if (!res.ok) { setError((await res.json()).error || 'Could not update the organization.'); return }
    router.refresh()
  }

  async function revokeInvite(invite: InviteRow) {
    if (!confirm(
      `Revoke the invitation for ${invite.email || 'this address'}?\n\n` +
      'The link stops working immediately. You can always send a new one.'
    )) return

    setBusyId(invite.id); setError('')
    const res = await fetch('/api/admin/revoke-invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteId: invite.id }),
    })
    setBusyId(null)
    if (!res.ok) { setError((await res.json()).error || 'Could not revoke the invitation.'); return }
    router.refresh()
  }

  // Search rather than pagination: the operational question is "find this one
  // org", and a filter answers it at 20 orgs or 200 without any page state.
  const shown = query.trim()
    ? orgs.filter(o => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : orgs

  const activeCount = orgs.filter(o => !o.disabled_at).length

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-extrabold tracking-tight">Platform</h1>
        <div className="flex items-center gap-2">
          <Link href="/dashboard"><Button variant="ghost" size="sm">Back to app</Button></Link>
          <Link href="/superadmin/invite-org"><Button size="sm">New org invite</Button></Link>
        </div>
      </div>
      <p className="text-sm text-muted mb-6">
        {activeCount} active {activeCount === 1 ? 'organization' : 'organizations'}
        {orgs.length !== activeCount && ` · ${orgs.length - activeCount} suspended`}
      </p>

      {error && (
        <div className="rounded-field bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger mb-4">
          {error}
        </div>
      )}

      <Card className="p-5 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted">Organizations</p>
          {orgs.length > 5 && (
            <input
              placeholder="Search organizations"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="rounded-field bg-surface-2 border border-line px-3 py-1.5 text-sm text-ink placeholder:text-muted outline-none focus:border-accent"
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          {shown.length === 0 && (
            <p className="text-sm text-muted">No organizations match &ldquo;{query}&rdquo;.</p>
          )}
          {shown.map(org => (
            <div key={org.id} className="rounded-field bg-surface-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{org.name}</p>
                    {org.disabled_at
                      ? <Chip tone="danger">Suspended</Chip>
                      : <Chip tone="good">Active</Chip>}
                    {org.plan && <Chip tone="neutral">{org.plan}</Chip>}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {org.members} {org.members === 1 ? 'member' : 'members'} ·{' '}
                    {org.shows} {org.shows === 1 ? 'show' : 'shows'} ·{' '}
                    created {fmtDate(org.created_at)}
                    {org.trialEndsAt && ` · trial ends ${fmtDate(org.trialEndsAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === org.id}
                    onClick={() => setScheduling(org, !org.schedulingEnabled)}
                    title={org.schedulingEnabled
                      ? 'Scheduling is on for this organization'
                      : 'Scheduling is off for this organization'}
                  >
                    {org.schedulingEnabled ? 'Scheduling: on' : 'Scheduling: off'}
                  </Button>
                  <Button
                    variant={org.disabled_at ? 'ghost' : 'danger'}
                    size="sm"
                    disabled={busyId === org.id}
                    onClick={() => setOrgStatus(org, !org.disabled_at)}
                  >
                    {busyId === org.id ? 'Working…' : org.disabled_at ? 'Re-enable' : 'Suspend'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted mb-1">Pending invitations</p>
        <p className="text-xs text-muted mb-4">
          Unaccepted invites. Each one is a working link until it is revoked or expires.
        </p>

        {invites.length === 0 ? (
          <p className="text-sm text-muted">Nothing pending.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {invites.map(inv => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm text-ink">{inv.email || 'No address'}</p>
                    <Chip tone={inv.isNewOrg ? 'live' : 'neutral'}>
                      {inv.isNewOrg ? 'New org' : 'Team member'}
                    </Chip>
                    {inv.expired && <Chip tone="danger">Expired</Chip>}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {inv.orgLabel} · {inv.expired ? 'expired' : 'expires'} {fmtDate(inv.expires_at)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === inv.id}
                  onClick={() => revokeInvite(inv)}
                >
                  {busyId === inv.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
