'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Google sign-in that happens ON THIS SITE.
//
// Dan, 2026-09-17, looking at the Google screen: it reads "Sign in to continue
// to nfrvxkwemtittrqboebl.supabase.co", because the button handed the person to
// Supabase and Google names the site it is sending them to. That is the truth
// and it looks exactly like a phishing page to anybody who does not know what
// Supabase is — on the first screen a new customer ever sees.
//
// The paid fix is Supabase's Custom Domains add-on. This is the free one, and
// it is arguably better: Google's own account chooser opens OVER this page, so
// the person never leaves crewtracker.app and the name Google prints is ours.
// Google hands us an ID token and Supabase trades it for a session — no
// redirect anywhere.
//
// IT DEGRADES TO THE OLD BUTTON RATHER THAN TO NOTHING. This is the front door.
// Without a client id configured, and if Google's script fails to load or
// refuses to render, the caller puts the original redirect button back. A login
// page with no Google button at all would be a worse bug than the one this
// fixes.
//
// THE NONCE IS NOT DECORATION. Google is given the SHA-256 HASH of a random
// value and Supabase is given the raw value; Supabase hashes it again and
// compares. That is what stops a token minted for somebody else's page being
// replayed into ours. The two must be the same value in the two forms, which is
// the one thing easy to get subtly wrong here.

declare global {
  interface Window {
    google?: any
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const raw = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hashed = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  return { raw, hashed }
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('script failed')))
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('script failed'))
    document.head.appendChild(script)
  })
}

export default function GoogleSignIn({
  clientId,
  onError,
  onUnavailable,
}: {
  clientId: string
  /** Shown on the login page, in the same place every other error appears. */
  onError: (message: string) => void
  /** Google could not be reached: put the redirect button back. */
  onUnavailable: () => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    // If Google has not rendered anything after a few seconds, it is not
    // coming — a blocked script, an extension, a captive-portal wifi at a
    // venue. Hand back rather than leaving somebody looking at a gap.
    const giveUp = setTimeout(() => {
      if (!cancelled && !holder.current?.childElementCount) onUnavailable()
    }, 5000)

    ;(async () => {
      try {
        await loadScript()
        if (cancelled) return
        const { raw, hashed } = await makeNonce()
        if (cancelled) return

        window.google.accounts.id.initialize({
          client_id: clientId,
          // Hashed to Google, raw to Supabase. See the header.
          nonce: hashed,
          // One Tap is deliberately NOT used: it is the piece browsers keep
          // changing the rules for, and a button somebody chose to press is
          // both more predictable and easier to explain.
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: async (response: { credential?: string }) => {
            if (!response?.credential) {
              onError('Google did not return a sign-in. Try again.')
              return
            }
            setBusy(true)
            const supabase = createClient()
            const { error } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: response.credential,
              nonce: raw,
            })
            if (error) {
              setBusy(false)
              onError(error.message)
              return
            }
            // A full navigation, not a router push: the session lands in
            // cookies and the server has to read them on the next request.
            window.location.href = '/dashboard'
          },
        })

        if (holder.current) {
          window.google.accounts.id.renderButton(holder.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'center',
            width: 320,
          })
        }
      } catch {
        if (!cancelled) onUnavailable()
      }
    })()

    return () => { cancelled = true; clearTimeout(giveUp) }
  }, [clientId, onError, onUnavailable])

  return (
    <div className="mb-6">
      {/* Google renders its own button in here — their mark, their wording.
          Their branding rules require it, and it is the thing people already
          recognise, so it is not a place to apply Showbill. */}
      <div ref={holder} className="flex justify-center" />
      {busy && <p className="mt-2 text-center text-xs text-muted">Signing you in…</p>}
    </div>
  )
}
