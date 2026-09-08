// THE DEMO COMPANY'S TEAM.
//
// Dan, 2026-09-08: "I need some people on my team to give permissions to. I can
// do a demo with a few different permissions." One login cannot show what this
// app actually does — the whole point of the permissions model is that a
// scheduler, a PM, an office manager and a crew member each open the same show
// and see a different app. This creates one login per view.
//
//   npm run demo:team
//
// Every address is a plus-addressed alias of dan@theaudiosmith.com, so every
// one of these people IS Dan and their mail lands in his inbox. They are
// members of the DEMO organization only: a membership is per company, so none
// of them can see CrewTracker Shows, the real one, no matter what.
//
// PRODUCTION ON PURPOSE, and it refuses to be anything else: it reads the
// _PROD keys explicitly (in .env.local the unsuffixed ones are DEV), checks the
// project ref, and then checks that the organization it is about to add people
// to is actually called "CrewTracker Demo".
//
// Safe to run again. An address that already has a login keeps it and has its
// password reset and its permissions rewritten, so this is also how a demo
// account gets un-broken after a rehearsal.

import { createClient } from '@supabase/supabase-js'
import { PERMISSION_PRESETS, ALL_PERMISSION_KEYS, type PermissionValues } from '@/lib/permissions'

const PRODUCTION_REF = 'nfrvxkwemtittrqboebl'
const DEMO_ORG_NAME = 'CrewTracker Demo'
const DEFAULT_PASSWORD = 'CrewTrackerDemo2026!'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL_PROD ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD ?? ''
const password = process.argv[2] || DEFAULT_PASSWORD

if (!url || !serviceKey) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL_PROD and SUPABASE_SERVICE_ROLE_KEY_PROD in .env.local.')
  process.exit(1)
}
if (!url.includes(PRODUCTION_REF)) {
  console.error(`REFUSED: NEXT_PUBLIC_SUPABASE_URL_PROD is not production (${PRODUCTION_REF}).`)
  process.exit(1)
}

// A person, and what the app looks like to them. `extra` is applied over the
// preset, so the difference from the standard role is the only thing written
// out — which is also the thing worth reading in a demo.
type Member = {
  name: string
  email: string
  role: keyof typeof PERMISSION_PRESETS
  extra?: Partial<PermissionValues>
  sees: string
}

const TEAM: Member[] = [
  {
    name: 'Sasha Vine',
    email: 'dan+sasha@theaudiosmith.com',
    role: 'staff',
    extra: { can_manage_scheduling: true },
    sees: 'Scheduler. The Needs-scheduling queue and the Scheduling screen; books and asks crew. No pay rates, cannot build a show.',
  },
  {
    name: 'Ray Delgado',
    email: 'dan+ray@theaudiosmith.com',
    role: 'pm',
    sees: 'Production manager. Runs the show on the day: tracker, punches, reports, pay rates. Only shows he is on.',
  },
  {
    name: 'Meredith Cole',
    email: 'dan+meredith@theaudiosmith.com',
    role: 'staff',
    extra: {
      can_edit_timecards: false,
      can_view_pay_rates: true,
      can_export_reports: true,
      can_send_reports: true,
    },
    sees: 'The office. Reads and exports reports and sees the money, but cannot change a punch or staff anybody.',
  },
  {
    // The address matches the directory entry for Alex Reyes, which is what
    // makes this a CREW login: migration 0028 links crew_members.profile_id by
    // email inside one company, and that link is what turns the show into "your
    // own days" instead of the whole roster.
    name: 'Alex Reyes',
    email: 'dan+alex@theaudiosmith.com',
    role: 'crew',
    sees: 'Crew. Their own days on the show and their own punches. No directory, no reports, no money, nobody else\'s hours.',
  },
]

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: org, error: orgError } = await admin
  .from('organizations').select('id, name').eq('name', DEMO_ORG_NAME).maybeSingle()

if (orgError || !org) {
  console.error(`REFUSED: no organization called "${DEMO_ORG_NAME}" on production.`)
  process.exit(1)
}

console.log(`  ⚠  PRODUCTION (${PRODUCTION_REF}) — adding people to ${org.name}\n`)

/** The login for this address, made if it is not there yet. */
async function findOrCreateUser(email: string, name: string): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  })
  if (created?.user) return created.user.id

  // Already exists: keep the login, reset the password so the demo works.
  const already = (error?.message ?? '').toLowerCase()
  if (!already.includes('already') && !already.includes('registered')) {
    throw new Error(`${email}: ${error?.message}`)
  }
  for (let page = 1; page <= 20; page++) {
    const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (listError) throw new Error(`listing users: ${listError.message}`)
    if (!data.users.length) break
    const found = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (found) {
      await admin.auth.admin.updateUserById(found.id, { password, user_metadata: { full_name: name } })
      return found.id
    }
  }
  throw new Error(`${email} exists but could not be found.`)
}

for (const m of TEAM) {
  const id = await findOrCreateUser(m.email, m.name)

  // The profile row is made by the on_auth_user_created trigger. Give it a
  // moment on a first creation rather than assuming the write has landed.
  let profile = null
  for (let tries = 0; tries < 10 && !profile; tries++) {
    const { data } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
    profile = data
    if (!profile) await new Promise(r => setTimeout(r, 300))
  }
  if (!profile) throw new Error(`${m.email}: no profile row was created.`)

  const perms = { ...PERMISSION_PRESETS[m.role], ...(m.extra ?? {}) }
  const membership: Record<string, unknown> = {
    profile_id: id,
    organization_id: org.id,
    base_role: m.role,
    deactivated_at: null,
  }
  for (const key of ALL_PERMISSION_KEYS) membership[key] = perms[key]

  const { error: memberError } = await admin
    .from('memberships').upsert(membership, { onConflict: 'profile_id,organization_id' })
  if (memberError) throw new Error(`${m.email}: ${memberError.message}`)

  // Without an active organization every page renders the "Almost there" card.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ full_name: m.name, email: m.email, active_organization_id: org.id })
    .eq('id', id)
  if (profileError) throw new Error(`${m.email}: ${profileError.message}`)

  const on = ALL_PERMISSION_KEYS.filter(k => perms[k])
  console.log(`✓ ${m.name} — ${m.email}`)
  console.log(`    ${m.sees}`)
  console.log(`    ${on.length ? on.join(', ') : 'no company permissions at all — everything comes from being staffed on a show'}\n`)
}

// Did the crew login find its directory entry? The link is by email, made by a
// trigger, and it is the whole crew-side story — say so either way rather than
// leaving it to be discovered mid-demo.
const { data: linked } = await admin
  .from('crew_members')
  .select('full_name, profile_id')
  .eq('organization_id', org.id)
  .eq('email', 'dan+alex@theaudiosmith.com')
  .maybeSingle()

console.log(linked?.profile_id
  ? '✓ Alex Reyes\'s login is linked to their crew directory entry — the crew view will work.'
  : '! Alex Reyes\'s login did NOT link to a directory entry. The crew view will show nothing.')

console.log(`\nPassword for all four: ${password}`)
console.log('They are members of the demo company only. Sign out, sign in as one of them, and the app changes.')
