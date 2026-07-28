'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Card from '@/components/ui/Card'
import { cn } from '@/lib/cn'

// Switching companies, on the Settings page.
//
// WHY THIS EXISTS AS WELL AS THE ACCOUNT MENU
// -------------------------------------------
// The account-menu switcher lives in AppShell's top header, which is
// `hidden … lg:flex` — it does not render at all below 1024px. Phones and
// portrait iPads get the bottom tab-bar instead, which has no account menu. So
// the switcher shipped desktop-only and was simply unreachable on a phone, which
// is where a PM moving between two production companies is most likely to be.
//
// Settings is the right home for the mobile route: it is one tap from the tab
// bar and already holds the account-level controls (name, preferences, log out).
// Rendered at every width rather than mobile-only, so there is one discoverable
// place that always works, with the account menu as the desktop shortcut.

export type SwitcherOrg = { id: string; name: string; isActive: boolean }

export default function OrgSwitcherCard({
  organizations,
  userId,
}: {
  organizations: SwitcherOrg[]
  userId: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  // One company is the ordinary case; a "switch company" card offering nothing
  // to switch to is just clutter.
  if (organizations.length < 2) return null

  const active = organizations.find(o => o.isActive)

  async function switchTo(orgId: string) {
    setBusy(orgId)
    setError('')
    const { data, error: e } = await supabase
      .from('profiles')
      .update({ active_organization_id: orgId })
      .eq('id', userId)
      .select('active_organization_id')

    // A refused update returns success with zero rows rather than an error —
    // see EditMemberClient for the same check and why.
    if (e || !data || data.length === 0) {
      setBusy(null)
      setError(e?.message ?? 'Could not switch company.')
      return
    }
    // Back to the dashboard rather than staying here: Settings itself is fine,
    // but anything else the user navigates to next should already be scoped to
    // the new company.
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold text-ink">Company</h2>
      <p className="mt-1 text-sm text-muted">
        You work for more than one company. Switching changes which shows, crew and
        permissions you see — everything else stays where it is.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {organizations.map(org => (
          <button
            key={org.id}
            onClick={() => !org.isActive && switchTo(org.id)}
            disabled={org.isActive || busy !== null}
            className={cn(
              'flex items-center justify-between rounded-field border px-4 py-3 text-left text-sm transition-colors',
              org.isActive
                ? 'border-accent bg-accent-wash text-ink ring-1 ring-inset ring-accent'
                : 'border-line bg-surface-2 text-ink hover:border-accent',
              busy !== null && !org.isActive && 'opacity-50',
            )}
          >
            <span className="truncate font-medium">{org.name}</span>
            <span className="ml-3 shrink-0 text-xs text-muted">
              {org.isActive ? 'Current' : busy === org.id ? 'Switching…' : 'Switch'}
            </span>
          </button>
        ))}
      </div>

      {active && (
        <p className="mt-3 text-xs text-muted">
          Currently acting in <span className="font-medium text-ink">{active.name}</span>.
        </p>
      )}
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </Card>
  )
}
