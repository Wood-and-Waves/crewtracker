'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import Logo from '@/components/Logo'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent disabled:opacity-60'

export default function InviteAuthForm({
  token,
  orgName,
  isNewOrg,
  restrictedEmail,
}: {
  token: string
  orgName: string | null
  isNewOrg: boolean
  restrictedEmail: string | null
}) {
  const supabase = createClient()
  const [email, setEmail] = useState(restrictedEmail || '')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  const callbackUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback?invite_token=${token}`

  async function finishAndRedirect() {
    const res = await fetch('/api/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return
    }
    window.location.href = '/dashboard'
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl },
    })
  }

  async function handleEmailAuth() {
    setError('')
    setLoading(true)
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callbackUrl },
      })
      if (error) setError(error.message)
      else setMagicSent(true)
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else await finishAndRedirect()
    }
    setLoading(false)
  }

  async function handleMagicLink() {
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    })
    if (error) setError(error.message)
    else setMagicSent(true)
    setLoading(false)
  }

  if (magicSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Check your email</h1>
          <p className="text-muted text-sm">We sent a confirmation link to <span className="text-ink">{email}</span>. Click it to continue.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 text-accent mb-2"><Logo /></div>
          <h1 className="text-2xl font-bold text-ink">CrewTracker</h1>
          <p className="mt-2 text-sm text-muted">
            {isNewOrg ? `You've been invited to create ${orgName}` : `You've been invited to join ${orgName}`}
          </p>
        </div>

        <button
          onClick={signInWithGoogle}
          className="flex w-full items-center justify-center gap-3 rounded-field bg-white px-4 py-3 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 mb-6"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="h-px flex-1 bg-line" />
          <span className="text-xs text-muted">or</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={!!restrictedEmail}
            className={inputCls}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleEmailAuth()}
            className={inputCls}
          />

          {error && <p className="text-xs text-danger">{error}</p>}

          <button
            onClick={handleEmailAuth}
            disabled={loading}
            className="w-full rounded-field bg-accent px-4 py-3 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Please wait...' : isSignUp ? 'Create Account & Join' : 'Sign In & Join'}
          </button>

          <button
            onClick={handleMagicLink}
            disabled={loading || !email}
            className="w-full rounded-field border border-line px-4 py-3 text-sm text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Send magic link instead
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError('') }}
            className="text-accent hover:opacity-80"
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  )
}
