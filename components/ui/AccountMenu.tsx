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

export default function AccountMenu({
  userName,
  userEmail,
}: {
  userName?: string
  userEmail?: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
          </div>
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
