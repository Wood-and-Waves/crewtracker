'use client'

import { createClient } from '@/lib/supabase/client'
import { readableAuthError } from '@/lib/authError'
import { useEffect, useState } from 'react'
import Logo from '@/components/Logo'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function LoginPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Only the magic-link path reaches this now; signup was removed.
  const [magicSent, setMagicSent] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlError = params.get('error')
    if (urlError) setError(urlError)
  }, [])

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  async function handleEmailAuth() {
    setError('')
    setLoading(true)
    // Sign in only — there is deliberately no signup path here.
    //
    // CrewTracker is invite-only: new organizations come from a superadmin
    // invite link, new teammates from an org invite, and both land on
    // /invite/[token], which is where account creation belongs. This page used
    // to offer "Don't have an account? Sign up", which called auth.signUp and
    // produced accounts belonging to no organization — contradicting the access
    // model and the security overview given to customers, which states there is
    // no public sign-up. Removed 2026-07-28, alongside the same defect in the
    // magic-link path.
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(readableAuthError(error))
    else window.location.href = '/dashboard'
    setLoading(false)
  }

  async function handleMagicLink() {
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // WITHOUT THIS, THE LOGIN PAGE IS A PUBLIC SIGNUP FORM.
        //
        // shouldCreateUser defaults to TRUE, so signInWithOtp creates an account
        // for any address typed in and sends the "Confirm signup" email rather
        // than a sign-in link. CrewTracker is invite-only — there is no public
        // signup anywhere else — so this quietly contradicted the whole access
        // model, and anyone who found the login page could mint an account.
        //
        // Caught 2026-07-28 when Dan asked for a magic link, received a signup
        // confirmation instead, and it recreated an account he had deleted the
        // day before.
        //
        // The invite page deliberately keeps the default: creating an account is
        // the point there, and it is gated by a valid invitation token.
        shouldCreateUser: false,
      },
    })
    // Supabase answers an unknown address with "Signups not allowed for otp",
    // which reads as a system fault rather than "there is no such account".
    //
    // This tells the user the address isn't registered rather than hiding it
    // behind a fake success. That does reveal whether an email has an account,
    // but the trade is worth it here: CrewTracker has no public signup, so the
    // knowledge buys an attacker nothing they can act on, while a PM who typed
    // their address wrong would otherwise sit waiting for an email that is never
    // coming.
    if (error) {
      setError(/signups not allowed/i.test(error.message ?? '')
        ? 'No CrewTracker account uses that email. Accounts are created by invitation — ask your company’s admin to send you one.'
        : readableAuthError(error))
    } else setMagicSent(true)
    setLoading(false)
  }

  async function handleForgotPassword() {
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    })
    if (error) setError(readableAuthError(error))
    else setResetSent(true)
    setLoading(false)
  }

  if (magicSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Check your email</h1>
          {/* Only the magic link reaches this screen now that signup is gone,
              so it can name what was actually sent. "Confirmation link" was
              left over from the signup path and described the wrong thing. */}
          <p className="text-muted text-sm">
            We sent a sign-in link to <span className="text-ink">{email}</span>. Click it to sign in.
          </p>
        </div>
      </div>
    )
  }

  if (resetSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Check your email</h1>
          <p className="text-muted text-sm">We sent a password reset link to <span className="text-ink">{email}</span>. Click it to set a password.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-card bg-surface border border-line p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 text-accent mb-2"><Logo className="w-12 h-12" /></div>
          <h1 className="text-2xl font-bold text-ink">CrewTracker</h1>
          <p className="mt-2 text-sm text-muted">
            Sign in to your account
          </p>
        </div>

        {/* Google SSO */}
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

        {/* Email/Password */}
        <div className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
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

          <button
            onClick={handleForgotPassword}
            disabled={loading || !email}
            className="self-end text-xs text-accent hover:opacity-80 disabled:opacity-50"
          >
            Forgot password?
          </button>

          {error && <p className="text-xs text-danger">{error}</p>}

          <button
            onClick={handleEmailAuth}
            disabled={loading}
            className="w-full rounded-field bg-accent px-4 py-3 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Please wait...' : 'Sign In'}
          </button>

          <button
            onClick={handleMagicLink}
            disabled={loading || !email}
            className="w-full rounded-field border border-line px-4 py-3 text-sm text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Send magic link instead
          </button>
        </div>

        {/* Replaces a "Sign up" toggle that created accounts belonging to no
            organization. Points at the beta form, which is the real way in. */}
        <p className="mt-6 text-center text-xs text-muted">
          CrewTracker accounts are created by invitation.{' '}
          <a href="/join-beta" className="text-accent hover:opacity-80">Request access</a>
        </p>
      </div>
    </div>
  )
}
