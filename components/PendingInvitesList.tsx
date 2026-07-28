'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { presetFor, ROLES, type Role } from '@/lib/permissions'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'

// Pending invitations, manageable by the organization's own admin.
//
// WHY
// ---
// Invitations are emailed when created (lib/inviteEmail.ts), but email fixes
// initial delivery and nothing else. A typo'd address, a message in a spam
// folder, someone who left before accepting, or simply "did I already invite
// them?" all still need this screen — which is why it was built first, before
// the email existed at all.
//
// Before either, the link was shown once in a modal and nowhere else, so closing
// that modal stranded the invitation: no way to see it existed, copy the link
// again, or cancel it. The only recovery was querying Postgres directly, which
// meant a support call to Dan every single time.
//
// No migration was needed: invitations already carries a single ALL policy gated
// on can_manage_users within the caller's organization, so an admin can already
// read, change and delete their own organization's invites.

export type PendingInvite = {
  id: string
  token: string
  email: string | null
  base_role: string | null
  expires_at: string
  created_at: string
}

function daysLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return null
  const days = Math.ceil(ms / 86_400_000)
  return days === 1 ? '1 day left' : `${days} days left`
}

export default function PendingInvitesList({ invites }: { invites: PendingInvite[] }) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (invites.length === 0) return null

  const linkFor = (token: string) => `${window.location.origin}/invite/${token}`

  async function copy(invite: PendingInvite) {
    setError('')
    try {
      await navigator.clipboard.writeText(linkFor(invite.token))
      setCopied(invite.id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard access can be refused (insecure context, permissions). Say so
      // rather than showing a "Copied" that didn't happen.
      setError('Could not copy automatically — select the link and copy it manually.')
    }
  }

  // Changing the role rewrites the permission preset too, so a pending invite
  // grants the same thing it would if created fresh at that role. Sending a new
  // invite instead would work, but it invalidates a link the admin may already
  // have passed on.
  async function changeRole(invite: PendingInvite, role: Role) {
    setBusy(invite.id)
    setError('')
    const { data, error: e } = await supabase
      .from('invitations')
      .update({ base_role: role, ...presetFor(role) })
      .eq('id', invite.id)
      .select('id')
    setBusy(null)
    // A refused update returns success with zero rows rather than an error.
    if (e || !data || data.length === 0) {
      setError(e?.message ?? 'That change was not permitted.')
      return
    }
    router.refresh()
  }

  // "I invited them but they never got it" is the single most likely support
  // question once email exists, so the admin needs to answer it themselves.
  async function resend(invite: PendingInvite) {
    setBusy(invite.id)
    setError('')
    try {
      const res = await fetch('/api/invites/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId: invite.id }),
      })
      const payload = await res.json()
      if (!res.ok) setError(payload.error || 'The email could not be sent.')
      else { setSent(invite.id); setTimeout(() => setSent(null), 3000) }
    } catch {
      setError('The email could not be sent.')
    }
    setBusy(null)
  }

  async function revoke(invite: PendingInvite) {
    if (!confirm(
      `Cancel the invitation to ${invite.email || 'this person'}?\n\n` +
      `The link stops working immediately. You can send a new invite at any time.`
    )) return

    setBusy(invite.id)
    setError('')
    const { data, error: e } = await supabase
      .from('invitations')
      .delete()
      .eq('id', invite.id)
      .select('id')
    setBusy(null)
    if (e || !data || data.length === 0) {
      setError(e?.message ?? 'That invitation could not be cancelled.')
      return
    }
    router.refresh()
  }

  return (
    <Card className="mt-8 p-6">
      <h2 className="text-lg font-bold text-ink">Pending invitations</h2>
      <p className="mt-1 text-sm text-muted">
        These people have been invited but haven&rsquo;t joined yet. They were emailed a link
        when the invite was created — resend it, or copy the link and send it yourself.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {invites.map(inv => {
          const left = daysLeft(inv.expires_at)
          return (
            <div
              key={inv.id}
              className="flex flex-col gap-3 rounded-field border border-line bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {inv.email || 'Anyone with the link'}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Chip tone={left ? 'neutral' : 'danger'}>{left ?? 'Expired'}</Chip>
                  <select
                    value={(inv.base_role as Role) ?? 'pm'}
                    onChange={e => changeRole(inv, e.target.value as Role)}
                    disabled={busy === inv.id}
                    // Safari renders <option> invisibly against a dark background
                    // without explicit classes — see CLAUDE.md.
                    className="rounded-field border border-line bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                  >
                    {ROLES.map(r => (
                      <option key={r.value} value={r.value} className="bg-surface-2 text-ink">
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                {inv.email && (
                  <Button size="sm" variant="ghost" onClick={() => resend(inv)} disabled={busy === inv.id}>
                    {sent === inv.id ? 'Sent' : busy === inv.id ? 'Sending…' : 'Resend email'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => copy(inv)} disabled={busy === inv.id}>
                  {copied === inv.id ? 'Copied' : 'Copy link'}
                </Button>
                <Button size="sm" variant="danger" onClick={() => revoke(inv)} disabled={busy === inv.id}>
                  {busy === inv.id ? '…' : 'Cancel'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  )
}
