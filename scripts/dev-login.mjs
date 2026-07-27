// Mint a DEVELOPMENT session and print it as browser cookies.
//
//   npm run dev:login                      session for the seeded admin
//   npm run dev:login -- someone@else.test  session for a specific dev user
//
// WHY THIS EXISTS
// ---------------
// Claude needs a logged-in browser to verify UI changes, and Supabase access
// tokens last an hour. Without this, Dan had to type his username and password
// into Claude's browser every hour to keep it going — which is both tedious and
// exactly the sort of thing nobody should be doing repeatedly. This mints a real
// session server-side from the service role key, so no password is typed by
// anyone and Claude can re-establish its own session whenever it expires.
//
// HOW
// ---
// admin.generateLink() produces a one-time token without sending an email;
// verifyOtp() redeems it for a genuine access/refresh token pair. The result is
// an ordinary session — the same thing signing in through the form produces —
// which is then formatted as the cookies @supabase/ssr reads.
//
// DEVELOPMENT ONLY, enforced below, no override. A script that mints a valid
// session for an arbitrary user is an authentication bypass; it is acceptable
// here solely because the target database holds generated fake data. Pointing it
// at production would hand out real sessions for real accounts.

import { createClient } from '@supabase/supabase-js'

const PRODUCTION_REF = 'nfrvxkwemtittrqboebl'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !serviceKey || !anonKey) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.')
  process.exit(1)
}
if (url.includes(PRODUCTION_REF)) {
  console.error(`
REFUSING TO RUN.

NEXT_PUBLIC_SUPABASE_URL points at production (${PRODUCTION_REF}). This mints a
valid login session without a password — it must only ever target development.
`)
  process.exit(1)
}

const ref = (url.match(/https:\/\/([a-z0-9]+)\./) || [])[1]
const email = process.argv[2] || 'dan@theaudiosmith.com'

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
if (linkErr) {
  console.error(`Could not generate a link for ${email}: ${linkErr.message}`)
  console.error('Is that user present in this project? (dev dashboard -> Authentication -> Users)')
  process.exit(1)
}

const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
const { data: sess, error: otpErr } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'email',
})
if (otpErr || !sess?.session) {
  console.error(`Could not redeem the link: ${otpErr?.message ?? 'no session returned'}`)
  process.exit(1)
}

const s = sess.session
// @supabase/ssr 0.12 stores the session as base64url JSON behind a "base64-"
// marker, split across numbered chunk cookies when it exceeds the browser's
// per-cookie limit. Emitting chunks unconditionally would be wrong for short
// sessions, so mirror the library's own threshold behaviour.
const CHUNK = 3180
const name = `sb-${ref}-auth-token`
const encoded = 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url')

const cookies = encoded.length <= CHUNK
  ? [[name, encoded]]
  : Array.from({ length: Math.ceil(encoded.length / CHUNK) },
      (_, i) => [`${name}.${i}`, encoded.slice(i * CHUNK, (i + 1) * CHUNK)])

console.log(JSON.stringify({
  project: ref,
  email,
  expires_at: new Date(s.expires_at * 1000).toISOString(),
  cookies: cookies.map(([n, v]) => ({ name: n, value: v })),
}, null, 2))
