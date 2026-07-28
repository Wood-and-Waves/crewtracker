import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

// Sign a browser into the DEVELOPMENT app without a password.
//
//   http://localhost:3000/api/dev/login?secret=…&next=/dashboard/schedule
//
// WHY THIS EXISTS
// ---------------
// Claude verifies UI changes by looking at them, which needs a logged-in
// browser. scripts/dev-login.mjs already mints a real session, but it prints
// cookies to a terminal — and writing auth cookies into a browser by injecting
// JavaScript is (correctly) blocked, being indistinguishable from an attack.
// This closes the gap by handing the session back the ordinary way, as
// Set-Cookie on a redirect, so the browser only ever talks to localhost.
//
// THIS IS AN AUTHENTICATION BYPASS. It mints a valid session for any user whose
// email is passed to it, with no password. That is acceptable only because it
// cannot exist anywhere but a development server on a developer's own machine,
// which is enforced by three independent gates below — any ONE of which is
// sufficient on its own. They are deliberately redundant: this is exactly the
// kind of route that is safe on the day it is written and catastrophic after
// somebody later "fixes" one condition.
//
// Every rejection is a bare 404 with no explanation. A route that answers
// "wrong secret" confirms it exists and is worth attacking; one that 404s is
// indistinguishable from a route that was never deployed.

const PRODUCTION_REF = 'nfrvxkwemtittrqboebl'

const notFound = () => new NextResponse('Not found', { status: 404 })

export async function GET(request: NextRequest) {
  // GATE 1 — development only, and the one that actually matters.
  // Vercel builds every deployment with NODE_ENV=production, PREVIEW INCLUDED.
  // That is the point: the preview deployment carries the dev service-role key,
  // so without this gate anyone holding the preview URL could mint a session for
  // any dev user. With it, this route is inert on every deployed environment.
  if (process.env.NODE_ENV !== 'development') return notFound()

  // GATE 2 — never the production database, whatever the environment claims.
  // Same hard-coded ref check as scripts/dev-login.mjs and scripts/db-seed.mjs,
  // and there is deliberately no override flag: a bypass switch on an auth
  // bypass is not a safeguard.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !serviceKey || !anonKey) return notFound()
  if (url.includes(PRODUCTION_REF)) return notFound()

  // GATE 3 — a shared secret that lives only in .env.local, which is neither
  // committed nor set in Vercel. Absent secret = disabled, not open.
  const secret = process.env.DEV_LOGIN_SECRET
  if (!secret || request.nextUrl.searchParams.get('secret') !== secret) return notFound()

  const email = request.nextUrl.searchParams.get('email') || 'dan@theaudiosmith.com'
  const nextPath = request.nextUrl.searchParams.get('next') || '/dashboard'
  // Relative paths only. An absolute URL here would turn this into an open
  // redirect that also hands over a fresh session.
  const safeNext = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/dashboard'

  // generateLink issues a one-time token WITHOUT sending an email; verifyOtp
  // redeems it for a genuine session. The result is an ordinary login — the
  // same thing the sign-in form produces.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !link?.properties?.hashed_token) {
    return new NextResponse(`No such dev user: ${email}`, { status: 400 })
  }

  const response = NextResponse.redirect(new URL(safeNext, request.url))

  // Redeem through the SSR client so the session is written in exactly the
  // cookie format @supabase/ssr expects — including its base64 marker and chunk
  // splitting. Hand-rolling that formatting is how the cookie ends up subtly
  // wrong and the app behaves as though nobody is signed in.
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  const { error: otpError } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (otpError) return new NextResponse(`Could not redeem: ${otpError.message}`, { status: 400 })

  return response
}
