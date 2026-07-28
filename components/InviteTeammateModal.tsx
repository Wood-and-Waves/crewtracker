'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import PermissionsEditor from '@/components/PermissionsEditor'
import { presetFor, type Role, type PermissionValues } from '@/lib/permissions'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function InviteTeammateModal({
  organizationId,
  invitedBy,
  onClose,
}: {
  organizationId: string
  invitedBy: string
  onClose: () => void
}) {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('pm')
  const [values, setValues] = useState<PermissionValues>(presetFor('pm'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  // Null = no address was given, so nothing was attempted.
  const [emailStatus, setEmailStatus] = useState<{ sentTo?: string; error?: string } | null>(null)

  async function createInvite() {
    setSaving(true)
    setError('')
    const { data, error: insertError } = await supabase
      .from('invitations')
      .insert({
        organization_id: organizationId,
        invited_by: invitedBy,
        is_new_organization: false,
        email: email.trim() || null,
        base_role: role,
        ...values,
      })
      .select('id, token')
      .single()

    if (insertError || !data) {
      setError(insertError?.message || 'Could not create the invite. Please try again.')
      setSaving(false)
      return
    }

    setInviteLink(`${window.location.origin}/invite/${data.token}`)

    // Send the email if an address was given. A failure here does NOT fail the
    // invite: the row exists and the link works, so we report it and fall back
    // to copying the link — which is also why the link stays on screen.
    if (email.trim()) {
      try {
        const res = await fetch('/api/invites/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invitationId: data.id }),
        })
        const payload = await res.json()
        setEmailStatus(res.ok ? { sentTo: payload.sentTo } : { error: payload.error || 'The email could not be sent.' })
      } catch {
        setEmailStatus({ error: 'The email could not be sent.' })
      }
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Invite Teammate</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">Close</button>
        </div>

        {inviteLink ? (
          <div>
            {emailStatus?.sentTo ? (
              <p className="mb-3 rounded-field bg-surface-2 px-3 py-2 text-sm text-ink">
                Invite emailed to <span className="font-medium">{emailStatus.sentTo}</span>. You can
                also share the link directly:
              </p>
            ) : emailStatus?.error ? (
              <p className="mb-3 rounded-field bg-surface-2 px-3 py-2 text-sm text-danger">
                Invite created, but the email didn&rsquo;t send ({emailStatus.error}) — send them
                this link instead:
              </p>
            ) : (
              <p className="mb-3 text-sm text-muted">
                Invite created — share this link with your teammate:
              </p>
            )}
            <div className="flex items-center gap-2">
              <input readOnly value={inviteLink} className={inputCls} />
              <Button size="sm" onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy</Button>
            </div>
            <p className="mt-3 text-xs text-muted">This link expires in 7 days.</p>
            <div className="mt-5">
              <Button variant="ghost" className="w-full" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-muted">Email (optional)</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="jane@example.com" />
              <p className="mt-1 text-xs text-muted">If provided, only this email can use the invite link. The teammate sets their own name when they accept.</p>
            </div>

            <PermissionsEditor
              role={role}
              values={values}
              onChange={next => { setRole(next.role); setValues(next.values) }}
            />

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" onClick={createInvite} disabled={saving}>
                {saving ? 'Creating…' : 'Create Invite'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
