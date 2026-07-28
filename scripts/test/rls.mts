// Security regression tests — the access rules, exercised for real.
//
//   npm run test:rls
//
// WHY THESE EXIST
// ---------------
// Everything here was verified by hand while it was built, repeatedly, and none
// of it was written down in a runnable form. That is fine once and untenable
// forever: these are the rules that keep one production company's crew, rates
// and shows away from another's, and they are enforced in Postgres where a
// careless policy edit changes them silently.
//
// HOW THEY RUN
// ------------
// `set role authenticated` plus a JWT claim — exactly what PostgREST does per
// request — so RLS is genuinely enforced. CLAUDE.md warns that `npm run db:sql`
// bypasses RLS entirely and can never prove enforcement; this does not, because
// it stops being the superuser before asserting anything.
//
// DEVELOPMENT ONLY, enforced below. The suite creates organizations, users and
// shows and deletes them again. Pointed at production it would be writing to
// customer data.

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const PRODUCTION_REF = 'nfrvxkwemtittrqboebl'
const url = process.env.DATABASE_URL ?? ''
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1) }
if (url.includes(PRODUCTION_REF) || (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes(PRODUCTION_REF)) {
  console.error('\nREFUSING TO RUN: this points at production. These tests create and delete data.\n')
  process.exit(1)
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } })
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = (s: string, p?: unknown[]) => c.query(s, p as never).then(r => r.rows as Record<string, any>[])

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') =>
  cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}  ${detail}`))

/** Run fn as a signed-in user, with RLS on. Always rolled back. */
async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await c.query('begin')
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated' })])
  try { return await fn() } finally { await c.query('rollback') }
}
/** Expected-failure probe. The savepoint keeps the transaction usable after it. */
async function probe(sql: string, p?: unknown[]) {
  await c.query('savepoint s')
  try { const r = await c.query(sql, p as never); await c.query('release savepoint s'); return { ok: true, n: r.rowCount ?? 0 } }
  catch (e: any) { await c.query('rollback to savepoint s'); return { ok: false, code: e.code as string } }
}

// ---------- fixtures ----------
const TAG = `rlstest-${Date.now()}`
const created = { orgs: [] as string[], users: [] as string[] }

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true })
  if (error) throw new Error(`could not create ${email}: ${error.message}`)
  created.users.push(data.user!.id)
  return data.user!.id
}
async function makeOrg(name: string) {
  const [o] = await q(`insert into organizations (name) values ($1) returning id`, [name])
  created.orgs.push(o.id)
  return o.id as string
}

console.log(`Setting up fixtures (${TAG})…`)
const orgA = await makeOrg(`${TAG}-CompanyA`)
const orgB = await makeOrg(`${TAG}-CompanyB`)
const alice = await makeUser(`${TAG}-alice@example.test`)   // admin at A
const bob = await makeUser(`${TAG}-bob@example.test`)       // pm at B, no rate access

await q(`insert into memberships (profile_id, organization_id, base_role, can_manage_users,
           can_view_pay_rates, can_edit_pay_rates, can_create_shows, can_edit_timecards,
           can_edit_all_shows, can_manage_crew_directory, can_manage_rulesets)
         values ($1,$2,'admin',true,true,true,true,true,true,true,true)`, [alice, orgA])
await q(`insert into memberships (profile_id, organization_id, base_role, can_create_shows,
           can_edit_timecards, can_edit_all_shows)
         values ($1,$2,'pm',true,true,true)`, [bob, orgB])

const [showA] = await q(`insert into shows (organization_id, name, start_date, end_date, show_financials)
                         values ($1,'A Show','2026-09-01','2026-09-02',true) returning id`, [orgA])
const [showB] = await q(`insert into shows (organization_id, name, start_date, end_date, show_financials)
                         values ($1,'B Show','2026-09-01','2026-09-02',true) returning id`, [orgB])
await q(`insert into crew_members (organization_id, full_name) values ($1,'A Crew'),($2,'B Crew')`, [orgA, orgB])
const [wdA] = await q(`insert into work_days (show_id, date, day_number) values ($1,'2026-09-01',1) returning id`, [showA.id])
const [roomA] = await q(`insert into rooms (work_day_id, name) values ($1,'Main') returning id`, [wdA.id])
const [tcA] = await q(`insert into timecards (room_id, crew_member_name, role, day_rate)
                       values ($1,'A Person','A1',777) returning id`, [roomA.id])

try {
  console.log('\n=== one company cannot see another ===')
  await asUser(alice, async () => {
    const shows = await q(`select name from shows where name in ('A Show','B Show')`)
    check('A sees only its own show', shows.length === 1 && shows[0].name === 'A Show', JSON.stringify(shows))
    const crew = await q(`select full_name from crew_members where full_name in ('A Crew','B Crew')`)
    check('A sees only its own crew', crew.length === 1 && crew[0].full_name === 'A Crew', JSON.stringify(crew))
    const orgs = await q(`select name from organizations where name like $1`, [`${TAG}%`])
    check('A sees only the company it belongs to', orgs.length === 1, JSON.stringify(orgs))
  })
  await asUser(bob, async () => {
    const shows = await q(`select name from shows where name in ('A Show','B Show')`)
    check('B sees only its own show', shows.length === 1 && shows[0].name === 'B Show', JSON.stringify(shows))
  })

  console.log('\n=== pay rates are not readable, even by an admin who may see them ===')
  await asUser(alice, async () => {
    check('direct timecards.day_rate is refused', (await probe(`select day_rate from timecards limit 1`)).code === '42501')
    check('direct rate_cards.day_rate is refused', (await probe(`select day_rate from rate_cards limit 1`)).code === '42501')
    const v = await q(`select day_rate from timecard_day_rates where timecard_id=$1`, [tcA.id])
    check('the permission-checked view returns the rate', Number(v[0]?.day_rate) === 777, JSON.stringify(v))
  })
  await asUser(bob, async () => {
    const v = await q(`select count(*)::int n from timecard_day_rates where day_rate is not null`)
    check('a user without can_view_pay_rates gets no rates from the view', v[0].n === 0, `${v[0].n}`)
  })

  console.log('\n=== permissions gate the matching action, live ===')
  const setPerm = (uid: string, col: string, val: boolean, org: string) =>
    q(`update memberships set ${col}=$3 where profile_id=$1 and organization_id=$2`, [uid, org, val])

  await setPerm(alice, 'can_create_shows', false, orgA)
  await asUser(alice, async () => {
    const r = await probe(`insert into shows (organization_id,name,start_date,end_date) values ($1,'Nope','2026-09-01','2026-09-02')`, [orgA])
    check('can_create_shows=false blocks creating a show', !r.ok || r.n === 0, r.ok ? `inserted ${r.n}` : '')
  })
  await setPerm(alice, 'can_create_shows', true, orgA)
  await asUser(alice, async () => {
    const r = await probe(`insert into shows (organization_id,name,start_date,end_date) values ($1,'Yep','2026-09-01','2026-09-02')`, [orgA])
    check('can_create_shows=true allows it again', r.ok && r.n === 1, r.ok ? '' : r.code)
  })

  await setPerm(alice, 'can_edit_pay_rates', false, orgA)
  await asUser(alice, async () => {
    const r = await probe(`update timecards set day_rate=1 where id=$1`, [tcA.id])
    check('changing a rate without permission is refused', !r.ok, r.ok ? 'ALLOWED' : '')
    const ins = await probe(`insert into timecards (room_id, crew_member_name, role, day_rate) values ($1,'Probe','Zzz',999)`, [roomA.id])
    check('but staffing still works — a PM\'s actual job', ins.ok, ins.ok ? '' : ins.code)
  })
  await setPerm(alice, 'can_edit_pay_rates', true, orgA)

  console.log('\n=== removed and misdirected users get nothing ===')
  await q(`update memberships set deactivated_at=now() where profile_id=$1 and organization_id=$2`, [alice, orgA])
  await asUser(alice, async () => {
    const [r] = await q(`select my_organization_id()::text o`)
    check('a deactivated member resolves to no organization', r.o === null, `${r.o}`)
    const s = await q(`select count(*)::int n from shows`)
    check('and sees no shows at all', s[0].n === 0, `${s[0].n}`)
  })
  await q(`update memberships set deactivated_at=null where profile_id=$1 and organization_id=$2`, [alice, orgA])

  // The pointer must never be the thing that grants access.
  await q(`update profiles set active_organization_id=$2 where id=$1`, [alice, orgB])
  await asUser(alice, async () => {
    const [r] = await q(`select my_organization_id()::text o`)
    check('pointing active_organization_id at a company you are not in grants nothing', r.o === null, `${r.o}`)
    const s = await q(`select count(*)::int n from shows`)
    check('and still shows nothing', s[0].n === 0, `${s[0].n}`)
  })
  await q(`update profiles set active_organization_id=$2 where id=$1`, [alice, orgA])

  console.log('\n=== a finalized show is frozen ===')
  await q(`update shows set finalized_at=now() where id=$1`, [showA.id])
  await asUser(alice, async () => {
    const r = await probe(`insert into punches (timecard_id, punch_type, punched_at) values ($1,'start',now())`, [tcA.id])
    check('punches cannot be added to a locked show', !r.ok || r.n === 0, r.ok ? `inserted ${r.n}` : '')
    const u = await probe(`update timecards set role='Changed' where id=$1`, [tcA.id])
    check('timecards cannot be edited on a locked show', !u.ok || u.n === 0, u.ok ? `updated ${u.n}` : '')
  })
  await q(`update shows set finalized_at=null where id=$1`, [showA.id])

  console.log('\n=== signed out, nothing is visible ===')
  await c.query('begin'); await c.query('set local role anon')
  for (const t of ['shows', 'crew_members', 'timecards', 'punches', 'memberships', 'profiles', 'organizations']) {
    const r = await probe(`select count(*)::int n from ${t}`)
    const rows = r.ok ? (await q(`select count(*)::int n from ${t}`))[0].n : -1
    check(`anonymous sees nothing in ${t}`, !r.ok || rows === 0, r.ok ? `saw ${rows}` : `err ${r.code}`)
  }
  await c.query('rollback')

} finally {
  console.log('\nTearing down fixtures…')
  await q(`delete from shows where organization_id = any($1)`, [created.orgs])
  await q(`delete from crew_members where organization_id = any($1)`, [created.orgs])
  await q(`delete from memberships where organization_id = any($1)`, [created.orgs])
  await q(`delete from invitations where organization_id = any($1)`, [created.orgs])
  await q(`delete from organizations where id = any($1)`, [created.orgs])
  for (const u of created.users) await admin.auth.admin.deleteUser(u)
  const [left] = await q(`select count(*)::int n from organizations where name like $1`, [`${TAG}%`])
  check('all fixtures removed', left.n === 0, `${left.n} left behind`)
  await c.end()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
