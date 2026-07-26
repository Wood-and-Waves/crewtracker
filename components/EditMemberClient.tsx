'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import PermissionsEditor from '@/components/PermissionsEditor'
import type { Role, PermissionKey, PermissionValues } from '@/lib/permissions'

export default function EditMemberClient({
  member,
  initialRole,
  initialValues,
  isSelf,
}: {
  member: { id: string; full_name: string | null; email: string | null; deactivated_at?: string | null }
  initialRole: Role
  initialValues: PermissionValues
  isSelf: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [role, setRole] = useState<Role>(initialRole)
  const [values, setValues] = useState<PermissionValues>(initialValues)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)

  const removed = !!member.deactivated_at
  const who = member.full_name || member.email || 'this person'

  // Removing keeps the profile row: shows.created_by and shows.finalized_by
  // point at it, and "who finalized this payroll report" shouldn't disappear
  // when someone leaves. Their organization link is what's cut — enforced in the
  // database via my_organization_id(), not just hidden here.
  async function setRemoved(next: boolean) {
    if (next && !confirm(
      `Remove ${who} from your organization?\n\n` +
      `They lose access immediately. Their name stays on the shows they worked, ` +
      `and you can restore them at any time.\n\n` +
      `This does not delete their CrewTracker login — it just no longer belongs to your organization.`
    )) return

    setRemoving(true)
    setError('')
    const { error: e } = await supabase
      .from('profiles')
      .update({ deactivated_at: next ? new Date().toISOString() : null })
      .eq('id', member.id)
    setRemoving(false)
    if (e) { setError(e.message); return }
    router.push('/dashboard/team')
    router.refresh()
  }

  const lockedKeys: PermissionKey[] = isSelf ? ['can_manage_users'] : []

  async function handleSave() {
    setSaving(true)
    setError('')
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ base_role: role, ...values })
      .eq('id', member.id)

    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }
    router.push('/dashboard/team')
    router.refresh()
  }

  return (
    <div className="p-6 md:p-10">
      <button onClick={() => router.push('/dashboard/team')} className="mb-6 text-sm text-muted hover:text-accent">
        ← Back to Team
      </button>

      <h1 className="mb-1 text-2xl font-bold text-ink">{member.full_name || 'Team member'}</h1>
      <p className="mb-6 text-sm text-muted">{member.email || '—'}</p>

      <div className="max-w-lg">
        <PermissionsEditor
          role={role}
          values={values}
          onChange={next => { setRole(next.role); setValues(next.values) }}
          lockedKeys={lockedKeys}
        />

        {isSelf && (
          <p className="mt-3 text-xs text-muted">
            You can&apos;t remove your own “Manage users” permission.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => router.push('/dashboard/team')}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>

        {/* Kept away from Save so it can't be hit by accident, and hidden on your
            own row — the database refuses self-removal anyway, but offering the
            button would be inviting an error message. */}
        {!isSelf && (
          <div className="mt-8 border-t border-line pt-5">
            {removed ? (
              <>
                <p className="text-sm text-ink">{who} has been removed from your organization.</p>
                <p className="mt-1 text-xs text-muted">
                  They can&rsquo;t sign in to anything here. Their name still appears on the shows they worked.
                </p>
                <Button variant="ghost" size="sm" className="mt-3" disabled={removing}
                  onClick={() => setRemoved(false)}>
                  {removing ? 'Restoring…' : 'Restore access'}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink">Remove from organization</p>
                <p className="mt-1 text-xs text-muted">
                  Ends their access straight away. Their work history is kept and you can restore
                  them later. Their CrewTracker login isn&rsquo;t deleted.
                </p>
                <Button variant="danger" size="sm" className="mt-3" disabled={removing}
                  onClick={() => setRemoved(true)}>
                  {removing ? 'Removing…' : `Remove ${who}`}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
