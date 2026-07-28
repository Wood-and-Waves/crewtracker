'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InviteTeammateModal from '@/components/InviteTeammateModal'
import PendingInvitesList, { type PendingInvite } from '@/components/PendingInvitesList'
import Chip from '@/components/ui/Chip'
import { cn } from '@/lib/cn'

type Member = {
  id: string; full_name: string | null; email: string | null; base_role: string | null
  /** Set once an admin removes them; the row is kept so past shows still credit them. */
  deactivated_at?: string | null
}

export default function TeamListClient({
  organizationId,
  invitedBy,
  members,
  invites = [],
}: {
  organizationId: string
  invitedBy: string
  members: Member[]
  invites?: PendingInvite[]
}) {
  const router = useRouter()
  const [inviting, setInviting] = useState(false)

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">Team</h1>
        <Button size="sm" onClick={() => setInviting(true)}>+ Invite Teammate</Button>
      </div>

      {members.length === 0 ? (
        <p className="text-muted">No team members yet.</p>
      ) : (
        <>
          {/* Desktop: data table */}
          <div className="hidden overflow-hidden rounded-card border border-line bg-surface lg:block">
            <div className="grid grid-cols-[1.6fr_1.8fr_1fr] gap-3 border-b border-line px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-wide text-muted">
              <div>Name</div><div>Email</div><div>Role</div>
            </div>
            {members.map(m => (
              <div
                key={m.id}
                onClick={() => router.push(`/dashboard/team/${m.id}`)}
                className={cn(
                  'grid cursor-pointer grid-cols-[1.6fr_1.8fr_1fr] items-center gap-3 border-b border-line px-5 py-3 last:border-b-0 hover:bg-surface-2',
                  m.deactivated_at && 'opacity-50',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-ink">{m.full_name || '—'}</span>
                  {m.deactivated_at && <Chip tone="danger">Removed</Chip>}
                </div>
                <div className="truncate text-muted">{m.email || '—'}</div>
                <div className="capitalize text-muted">{m.base_role || '—'}</div>
              </div>
            ))}
          </div>

          {/* Mobile: tappable cards */}
          <div className="divide-y divide-line rounded-card border border-line bg-surface lg:hidden">
            {members.map(m => (
              <button
                key={m.id}
                onClick={() => router.push(`/dashboard/team/${m.id}`)}
                className={cn('flex w-full items-center justify-between p-4 text-left', m.deactivated_at && 'opacity-50')}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{m.full_name || m.email || '—'}</p>
                    <p className="text-xs capitalize text-muted">{m.base_role || '—'}</p>
                  </div>
                  {m.deactivated_at && <Chip tone="danger">Removed</Chip>}
                </div>
                <span className="text-muted">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Below the members, since these are people who aren't in the team yet.
          Renders nothing when there are none. */}
      <PendingInvitesList invites={invites} />

      {inviting && (
        <InviteTeammateModal
          organizationId={organizationId}
          invitedBy={invitedBy}
          onClose={() => { setInviting(false); router.refresh() }}
        />
      )}
    </div>
  )
}
