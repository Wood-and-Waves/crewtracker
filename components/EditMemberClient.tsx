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
  orgAdminCount,
}: {
  member: { id: string; full_name: string | null; email: string | null }
  initialRole: Role
  initialValues: PermissionValues
  isSelf: boolean
  orgAdminCount: number
}) {
  const router = useRouter()
  const supabase = createClient()
  const [role, setRole] = useState<Role>(initialRole)
  const [values, setValues] = useState<PermissionValues>(initialValues)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // A non-self edit that would remove the org's last admin is blocked client-side.
  const wouldRemoveLastAdmin =
    initialValues.can_manage_users && !values.can_manage_users && orgAdminCount <= 1

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
        {wouldRemoveLastAdmin && (
          <p className="mt-3 text-sm text-danger">
            This is the organization&apos;s last admin. Grant another member “Manage users” before removing it here.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => router.push('/dashboard/team')}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving || wouldRemoveLastAdmin}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
