// Set a DEVELOPMENT account's password, for when the generated one is lost.
//
//   npm run dev:password -- someone@example.test 'newpassword'
//
// Same shape and same guard as dev-login.mjs: this uses the service role, so it
// can change ANY account's password without knowing the old one. That is only
// acceptable against the dev database, which holds generated fake data — the
// hard-coded production ref below refuses to run anywhere else, and there is
// deliberately no override flag. A bypass switch on this would defeat the point.
//
// Passwords set here are throwaway dev credentials. Never reuse one on
// production: production holds real crew names, phone numbers and pay rates.

import { createClient } from '@supabase/supabase-js'

const PRODUCTION_REF = 'nfrvxkwemtittrqboebl'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const [email, password] = process.argv.slice(2)

if (!url || !serviceKey) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.')
  process.exit(1)
}
if (!email || !password) {
  console.error("Usage: npm run dev:password -- <email> '<password>'")
  process.exit(1)
}
if (url.includes(PRODUCTION_REF)) {
  console.error(`
REFUSED. NEXT_PUBLIC_SUPABASE_URL points at production (${PRODUCTION_REF}).
This script overwrites a password without knowing the old one, which must never
be pointed at real accounts. Point .env.local at dev and try again.
`)
  process.exit(1)
}

const projectRef = url.match(/https:\/\/([^.]+)\./)?.[1] ?? url
console.log(`  dev (${projectRef}) — setting password for ${email}`)

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// listUsers is paged; walk until the address turns up rather than assuming it
// is on the first page. A dev database seeded with fake crew can carry more
// logins than the default page size.
let user = null
for (let page = 1; page <= 20 && !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) {
    console.error(`Could not list users: ${error.message}`)
    process.exit(1)
  }
  if (!data.users.length) break
  user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase()) ?? null
}

if (!user) {
  console.error(`No such user on this database: ${email}`)
  process.exit(1)
}

const { error } = await admin.auth.admin.updateUserById(user.id, { password })
if (error) {
  console.error(`Could not set password: ${error.message}`)
  process.exit(1)
}

console.log(`✓ Password updated for ${email} (${user.id}).`)
console.log('  Dev credential only — do not reuse this password on production.')
