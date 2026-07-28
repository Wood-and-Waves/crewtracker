'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/cn'

function initialsFrom(name?: string, email?: string) {
  const source = (name || '').trim()
  if (source) {
    const parts = source.split(/\s+/)
    const first = parts[0]?.[0] ?? ''
    const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
    return (first + last).toUpperCase()
  }
  return (email?.[0] ?? '?').toUpperCase()
}

// Shape declared here rather than imported from lib/session: that module is
// server-only (it imports the server Supabase client), and this is a client
// component. See CLAUDE.md on the client/server export rule.
export type SwitcherOrg = { id: string; name: string; isActive: boolean }

export default function AccountMenu({
  userName,
  userEmail,
  organizations = [],
}: {
  userName?: string
  userEmail?: string
  organizations?: SwitcherOrg[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const active = organizations.find(o => o.isActive)
  const others = organizations.filter(o => !o.isActive)

  // Switching writes a pointer and nothing else. It grants no access on its own:
  // the database re-checks that a live membership exists for whatever it points
  // at on every request, so a stale or tampered value simply resolves to nothing.
  async function switchTo(orgId: string) {
    setSwitchingTo(orgId)
    setError('')
    const { data, error: e } = await supabase
      .from('profiles')
      .update({ active_organization_id: orgId })
      .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .select('active_organization_id')

    if (e || !data || data.length === 0) {
      setSwitchingTo(null)
      setError(e?.message ?? 'Could not switch organization.')
      return
    }
    setOpen(false)
    setSwitchingTo(null)
    // Send them to the dashboard rather than refreshing in place: the current
    // page is very likely a show or report belonging to the company they just
    // left, which would 404 the moment the switch takes effect.
    router.push('/dashboard')
    router.refresh()
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function logOut() {
    setLoading(true)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-wash text-sm font-bold text-accent ring-1 ring-inset ring-line transition-colors hover:ring-accent"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initialsFrom(userName, userEmail)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 rounded-card border border-line bg-surface p-2 shadow-xl"
        >
          <div className="border-b border-line px-3 py-2">
            {userName && <p className="truncate text-sm font-semibold text-ink">{userName}</p>}
            {userEmail && <p className="truncate text-xs text-muted">{userEmail}</p>}
            {/* Named even with one organization: knowing which company you are
                acting in matters most to the people who work for several, and
                they are exactly the ones who will misread an unlabelled menu. */}
            {active && (
              <p className="mt-2 truncate text-xs font-medium text-accent">{active.name}</p>
            )}
          </div>

          {others.length > 0 && (
            <div className="border-b border-line py-1">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Switch company
              </p>
              {others.map(org => (
                <button
                  key={org.id}
                  role="menuitem"
                  onClick={() => switchTo(org.id)}
                  disabled={switchingTo !== null}
                  className={cn(
                    'w-full truncate rounded-field px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2',
                    switchingTo !== null && 'opacity-50',
                  )}
                >
                  {switchingTo === org.id ? 'Switching…' : org.name}
                </button>
              ))}
            </div>
          )}

          {error && <p className="px-3 py-2 text-xs text-danger">{error}</p>}

          <button
            role="menuitem"
            onClick={logOut}
            disabled={loading}
            className={cn(
              'mt-1 w-full rounded-field px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-surface-2',
              loading && 'opacity-50',
            )}
          >
            {loading ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  )
}
