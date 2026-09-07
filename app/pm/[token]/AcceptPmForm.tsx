'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'

// One button. The answer is POSTed — never taken by following the link — so a
// mail scanner prefetching the URL cannot accept a show on somebody's behalf.

export default function AcceptPmForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function accept() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/pm/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setBusy(false)
      setError(body.error || 'Something went wrong. Please try again.')
      return
    }
    // Into the show. Signed out, the app asks them to sign in first.
    window.location.href = `/dashboard/shows/${body.showId}`
  }

  return (
    <div>
      <Button className="w-full" disabled={busy} onClick={accept}>
        {busy ? 'Opening…' : 'Accept and open the show'}
      </Button>
      {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}
    </div>
  )
}
