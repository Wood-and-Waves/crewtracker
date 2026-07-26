'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

// Sign out, for the screens that render OUTSIDE AppShell.
//
// Every other way out of the app lives in the shell — the account menu, the nav,
// the Settings page. The dead-end screens (no organization, suspended account)
// deliberately return before the shell renders, which left someone in that state
// with no way to sign out and no way to reach any page that had one: stuck in
// the app on a phone with nothing to tap. A removed teammate hit exactly that.

export default function SignOutButton({
  label = 'Sign out',
  variant = 'ghost',
}: {
  label?: string
  variant?: 'primary' | 'ghost' | 'danger'
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <Button variant={variant} onClick={signOut} disabled={busy}>
      {busy ? 'Signing out…' : label}
    </Button>
  )
}
