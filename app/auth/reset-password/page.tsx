'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleReset() {
    setError('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setDone(true)
      setTimeout(() => router.push('/dashboard'), 1500)
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Password set</h1>
          <p className="text-muted text-sm">Redirecting to your dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-ink">Set a new password</h1>
          <p className="mt-2 text-sm text-muted">Choose a password for your CrewTracker account.</p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={inputCls}
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleReset()}
            className={inputCls}
          />

          {error && <p className="text-xs text-danger">{error}</p>}

          <button
            onClick={handleReset}
            disabled={loading}
            className="w-full rounded-field bg-accent px-4 py-3 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Set Password'}
          </button>
        </div>
      </div>
    </div>
  )
}
