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
// Set explicitly, exactly as acceptInvite does. Nothing sets it implicitly since
// the profiles mirror was removed in 0009.
await q(`update profiles set active_organization_id=$2 where id=$1`, [alice, orgA])
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
const [punchA] = await q(`insert into punches (timecard_id, punch_type, punched_at)
                          values ($1,'start',now()) returning id`, [tcA.id])
// A member of company A who may see the show but must never change times.
const carol = await makeUser(`${TAG}-carol@example.test`)
await q(`insert into memberships (profile_id, organization_id, base_role, can_edit_timecards,
           can_edit_all_shows, view_only)
         values ($1,$2,'staff',false,true,true)`, [carol, orgA])

// The assignment branch. Until 2026-09-06 nothing in this suite exercised it:
// every fixture either saw all shows (alice, carol) or was in another company
// (bob), so `id in (select show_id from show_assignments ...)` in the shows
// policy — the branch a real non-admin PM lives on — was never tested. dave is
// a PM in company A who may edit timecards but is assigned to ONE show.
const [showA2] = await q(`insert into shows (organization_id, name, start_date, end_date)
                          values ($1,'A Show 2','2026-09-03','2026-09-04') returning id`, [orgA])
const [wdA2] = await q(`insert into work_days (show_id, date, day_number) values ($1,'2026-09-03',1) returning id`, [showA2.id])
const [roomA2] = await q(`insert into rooms (work_day_id, name) values ($1,'Main') returning id`, [wdA2.id])
const [tcA2] = await q(`insert into timecards (room_id, crew_member_name, role) values ($1,'A2 Person','A1') returning id`, [roomA2.id])
await q(`insert into punches (timecard_id, punch_type, punched_at) values ($1,'start',now())`, [tcA2.id])
// Company B gets a real day/room/timecard too, so "another company's timecard"
// is a concrete row and not just an idea.
const [wdB] = await q(`insert into work_days (show_id, date, day_number) values ($1,'2026-09-01',1) returning id`, [showB.id])
const [roomB] = await q(`insert into rooms (work_day_id, name) values ($1,'B Main') returning id`, [wdB.id])
const [tcB] = await q(`insert into timecards (room_id, crew_member_name, role) values ($1,'B Person','B1') returning id`, [roomB.id])
const dave = await makeUser(`${TAG}-dave@example.test`)     // pm at A, assigned to showA only
await q(`insert into memberships (profile_id, organization_id, base_role, can_edit_timecards,
           can_edit_all_shows, can_create_shows)
         values ($1,$2,'pm',true,false,false)`, [dave, orgA])
await q(`update profiles set active_organization_id=$2 where id=$1`, [dave, orgA])
await q(`insert into show_assignments (show_id, profile_id) values ($1,$2)`, [showA.id, dave])

// ---- Section 1 fixtures: a login that IS a directory entry (0028) ----
// sam has a login in org A (crew preset: nothing) and a directory entry in A
// with the same email, so the link is made automatically. A second directory
// entry in org B with the SAME email must stay unlinked: links never cross
// companies.
const samEmail = `${TAG}-sam@example.test`
const [samCrewA] = await q(`insert into crew_members (organization_id, full_name, email) values ($1,'Sam Crew',$2) returning id`, [orgA, samEmail.toUpperCase()])
const [samCrewB] = await q(`insert into crew_members (organization_id, full_name, email) values ($1,'Sam In B',$2) returning id`, [orgB, samEmail])
const sam = await makeUser(samEmail)
await q(`insert into memberships (profile_id, organization_id, base_role) values ($1,$2,'crew')`, [sam, orgA])
await q(`update profiles set active_organization_id=$2 where id=$1`, [sam, orgA])
// sam is staffed on showA (crew-side there) and assigned to showA2 (PM-side there).
const [tcSam] = await q(`insert into timecards (room_id, crew_member_id, crew_member_name, role) values ($1,$2,'Sam Crew','A1') returning id`, [roomA.id, samCrewA.id])
const [punchSam] = await q(`insert into punches (timecard_id, punch_type, punched_at, source) values ($1,'start',now(),'crew') returning id`, [tcSam.id])
await q(`insert into show_assignments (show_id, profile_id) values ($1,$2)`, [showA2.id, sam])

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

  console.log('\n=== punch writes require permission, not just membership (0019) ===')
  // The hole this closes: the old policies asked only "are you in this company?".
  // A view_only member could rewrite the hours people get paid for, on any show
  // in the org, including ones hidden from them. The app hid the controls; the
  // database did not.
  //
  // Note the two shapes of refusal. A blocked INSERT raises 42501, but a blocked
  // UPDATE or DELETE simply matches no rows and reports success — the
  // silent-success trap CLAUDE.md warns about — so those assert on the row count.
  await asUser(carol, async () => {
    const seen = await q(`select count(*)::int n from punches where id=$1`, [punchA.id])
    check('a view_only member can still SEE the punch', seen[0].n === 1, `${seen[0].n}`)

    const ins = await probe(`insert into punches (timecard_id, punch_type, punched_at) values ($1,'end',now())`, [tcA.id])
    check('but cannot create one', !ins.ok || ins.n === 0, ins.ok ? `inserted ${ins.n}` : '')

    const upd = await probe(`update punches set punched_at=now() where id=$1`, [punchA.id])
    check('cannot change one', !upd.ok || upd.n === 0, upd.ok ? `updated ${upd.n}` : '')

    const del = await probe(`delete from punches where id=$1`, [punchA.id])
    check('cannot delete one', !del.ok || del.n === 0, del.ok ? `deleted ${del.n}` : '')
  })

  // The same rule must not lock out the people whose job this is.
  await asUser(alice, async () => {
    const ins = await probe(`insert into punches (timecard_id, punch_type, punched_at) values ($1,'meal_out',now())`, [tcA.id])
    check('a timecard editor can still punch', ins.ok && ins.n === 1, ins.ok ? '' : ins.code)
    const upd = await probe(`update punches set punched_at=now() where id=$1`, [punchA.id])
    check('and can still correct one', upd.ok && upd.n === 1, upd.ok ? '' : upd.code)
  })

  // The other half of the hole: writing to a show in a company you are not in.
  await asUser(bob, async () => {
    const ins = await probe(`insert into punches (timecard_id, punch_type, punched_at) values ($1,'end',now())`, [tcA.id])
    check('another company cannot punch on our timecard', !ins.ok || ins.n === 0, ins.ok ? `inserted ${ins.n}` : '')
  })

  console.log('\n=== timecard writes require permission too (0020) ===')
  // Same hole as 0019, on the table one level up. Deleting a timecard is worse
  // than editing a punch: it removes somebody from the day and cascades their
  // punches with it.
  await asUser(carol, async () => {
    const seen = await q(`select count(*)::int n from timecards where id=$1`, [tcA.id])
    check('a view_only member can still SEE the timecard', seen[0].n === 1, `${seen[0].n}`)

    const ins = await probe(`insert into timecards (room_id, crew_member_name, role) values ($1,'Sneak','X')`, [roomA.id])
    check('but cannot staff anybody', !ins.ok || ins.n === 0, ins.ok ? `inserted ${ins.n}` : '')

    const upd = await probe(`update timecards set crew_member_name='Renamed' where id=$1`, [tcA.id])
    check('cannot rename one', !upd.ok || upd.n === 0, upd.ok ? `updated ${upd.n}` : '')

    const del = await probe(`delete from timecards where id=$1`, [tcA.id])
    check('cannot delete one — which would take the punches with it',
      !del.ok || del.n === 0, del.ok ? `deleted ${del.n}` : '')
  })

  // The staffing flows a PM actually uses must survive the tightening.
  await asUser(alice, async () => {
    const ins = await probe(`insert into timecards (room_id, crew_member_name, role) values ($1,'Staffed','A2')`, [roomA.id])
    check('a timecard editor can still staff', ins.ok && ins.n === 1, ins.ok ? '' : ins.code)

    // add_show_day is NOT security definer, so it runs under these policies and
    // its copy-crew step inserts timecards. This is the regression that a
    // careless tightening would cause, and it is invisible until somebody
    // presses Add Day on a real show.
    const rpc = await probe(`select add_show_day($1, true)`, [showA.id])
    check('and Add Day (copy crew) still works through the RPC', rpc.ok, rpc.ok ? '' : rpc.code)
    // 0023: the RPC inserts rooms and timecards with no show_id; the triggers
    // must stamp it, or the new day is invisible to every policy.
    const stamped = await q(`select count(*)::int n from timecards t join rooms r on r.id=t.room_id
                             join work_days w on w.id=r.work_day_id
                             where w.show_id=$1 and (t.show_id is distinct from w.show_id or r.show_id is distinct from w.show_id)`, [showA.id])
    check('and Add Day stamps the new rooms and timecards with the show', stamped[0].n === 0, `${stamped[0].n} mislabelled`)
  })

  console.log('\n=== show_id is derived, never chosen (0023) ===')
  // The flattened policies trust show_id, so the triggers that derive it are
  // now part of the security boundary. Each of these is a way a client could
  // try to choose it.
  {
    const [p] = await q(`select show_id from punches where id=$1`, [punchA.id])
    const [t] = await q(`select show_id from timecards where id=$1`, [tcA.id])
    const [r] = await q(`select show_id from rooms where id=$1`, [roomA.id])
    check('show_id is filled by the triggers and matches the chain',
      p.show_id === showA.id && t.show_id === showA.id && r.show_id === showA.id, `${p.show_id} ${t.show_id} ${r.show_id}`)
  }
  await asUser(alice, async () => {
    const relabel = await probe(`update punches set show_id=$2 where id=$1`, [punchA.id, showA2.id])
    const [after] = await q(`select show_id from punches where id=$1`, [punchA.id])
    check('a client cannot re-label a punch\'s show_id (the trigger overwrites it)',
      after.show_id === showA.id, relabel.ok ? `now ${after.show_id}` : relabel.code)

    const moved = await probe(`update punches set timecard_id=$2 where id=$1`, [punchA.id, tcB.id])
    check('moving a punch onto another company\'s timecard is refused', !moved.ok || moved.n === 0, moved.ok ? `moved ${moved.n}` : '')

    const movedTc = await probe(`update timecards set room_id=$2 where id=$1`, [tcA.id, roomB.id])
    check('and so is moving a timecard into another company\'s room', !movedTc.ok || movedTc.n === 0, movedTc.ok ? `moved ${movedTc.n}` : '')

    const vis = await probe(`select show_id from timecards where id=$1`, [tcA.id])
    const rate = await probe(`select day_rate from timecards where id=$1`, [tcA.id])
    check('timecards.show_id is readable and day_rate still is not', vis.ok && rate.code === '42501', `${vis.ok} ${rate.code}`)
  })
  await asUser(carol, async () => {
    const [r] = await q(`select (select count(*) from rooms where id=$1)::int rooms,
                                (select count(*) from timecards where id=$2)::int tcs,
                                (select count(*) from punches where id=$3)::int punches`, [roomA.id, tcA.id, punchA.id])
    check('a view-only member still sees rooms, timecards and punches after flattening',
      r.rooms === 1 && r.tcs === 1 && r.punches === 1, JSON.stringify(r))
  })

  console.log('\n=== an assigned PM sees exactly their shows (the show_assignments branch) ===')
  // This is the branch the performance rewrites (0021, 0023) touch most, and
  // the one no earlier fixture exercised. Baselined against the pre-0021
  // policies first, so a change in what dave can see is a real finding.
  await asUser(dave, async () => {
    const mine = await q(`select count(*)::int n from punches where id=$1`, [punchA.id])
    check('an assigned PM sees the punches on their show', mine[0].n === 1, `${mine[0].n}`)

    const rooms = await q(`select count(*)::int n from rooms where id=$1`, [roomA2.id])
    const tcs = await q(`select count(*)::int n from timecards where id=$1`, [tcA2.id])
    const pun = await q(`select count(*)::int n from punches where timecard_id=$1`, [tcA2.id])
    check('and none on a same-company show they are not assigned to',
      rooms[0].n === 0 && tcs[0].n === 0 && pun[0].n === 0, `rooms=${rooms[0].n} tcs=${tcs[0].n} punches=${pun[0].n}`)

    const ins = await probe(`insert into punches (timecard_id, punch_type, punched_at) values ($1,'meal_out',now())`, [tcA.id])
    check('an assigned PM with can_edit_timecards can punch on their show', ins.ok && ins.n === 1, ins.ok ? '' : ins.code)

    // The assignment half of the 0019 hole. Until now only the cross-company
    // half was tested.
    const hidden = await probe(`insert into punches (timecard_id, punch_type, punched_at) values ($1,'meal_out',now())`, [tcA2.id])
    check('but not on a show hidden from them, even with the permission',
      !hidden.ok || hidden.n === 0, hidden.ok ? `inserted ${hidden.n}` : '')
  })

  // The scheduler_id arm 0013 added to the shows policy.
  await q(`update shows set scheduler_id=$2 where id=$1`, [showA2.id, dave])
  await q(`update timecards set day_rate=321 where id=$1`, [tcA2.id])
  await asUser(dave, async () => {
    const days = await q(`select count(*)::int n from work_days where show_id=$1`, [showA2.id])
    check('a scheduler sees the show they were handed and its days', days[0].n === 1, `${days[0].n}`)
  })
  // 0026: the SECURITY DEFINER rates view carries its own copy of that rule,
  // and until 2026-09-06 it lacked this arm — a scheduler with the permission
  // got no rates on a handed-over show. Permission granted for this block only.
  await q(`update memberships set can_view_pay_rates=true where profile_id=$1 and organization_id=$2`, [dave, orgA])
  await asUser(dave, async () => {
    const v = await q(`select day_rate from timecard_day_rates where timecard_id=$1`, [tcA2.id])
    check('and, with the permission, the rates view shows that show\'s rates too', Number(v[0]?.day_rate) === 321, JSON.stringify(v))
  })
  await q(`update memberships set can_view_pay_rates=false where profile_id=$1 and organization_id=$2`, [dave, orgA])
  await asUser(dave, async () => {
    const v = await q(`select count(*)::int n from timecard_day_rates where timecard_id=$1`, [tcA2.id])
    check('but never without it', v[0].n === 0, `${v[0].n}`)
  })
  await q(`update shows set scheduler_id=null where id=$1`, [showA2.id])

  console.log('\n=== a login links to its directory entry by email (0028) ===')
  {
    const [a] = await q(`select profile_id from crew_members where id=$1`, [samCrewA.id])
    check('joining a company links the one directory entry with that email (case-insensitive)', a.profile_id === sam, `${a.profile_id}`)
    const [b] = await q(`select profile_id from crew_members where id=$1`, [samCrewB.id])
    check('and never a directory entry in another company', b.profile_id === null, `${b.profile_id}`)

    // Two entries sharing an email: neither is linked, and the existing link is
    // NOT disturbed by a newcomer.
    const [dup] = await q(`insert into crew_members (organization_id, full_name, email) values ($1,'Sam Twin',$2) returning id`, [orgA, samEmail])
    const [twin] = await q(`select profile_id from crew_members where id=$1`, [dup.id])
    const [still] = await q(`select profile_id from crew_members where id=$1`, [samCrewA.id])
    check('a second entry with the same email is not linked', twin.profile_id === null, `${twin.profile_id}`)
    check('and the first keeps its link', still.profile_id === sam, `${still.profile_id}`)
    await q(`delete from crew_members where id=$1`, [dup.id])

    // Changing the email away from the login clears the link; changing it back relinks.
    await q(`update crew_members set email='nobody@example.test' where id=$1`, [samCrewA.id])
    const [cleared] = await q(`select profile_id from crew_members where id=$1`, [samCrewA.id])
    check('an email that no longer matches clears the link', cleared.profile_id === null, `${cleared.profile_id}`)
    await q(`update crew_members set email=$2 where id=$1`, [samCrewA.id, samEmail])
    const [back] = await q(`select profile_id from crew_members where id=$1`, [samCrewA.id])
    check('and matching again relinks', back.profile_id === sam, `${back.profile_id}`)

    // The app's explicit relink for a row the triggers could not decide.
    await q(`update crew_members set profile_id=null where id=$1`, [samCrewA.id])
    const [r] = await q(`select relink_crew_member($1) as p`, [samCrewA.id])
    check('relink_crew_member() links an unlinked entry', r.p === sam, `${r.p}`)
  }

  console.log('\n=== crew-side: a staffed login sees only its own rows (0029) ===')
  {
    const [row] = await q(`select count(*)::int n from show_crew_access where show_id=$1 and profile_id=$2`, [showA.id, sam])
    check('staffing a linked person records their access to the show', row.n === 1, `${row.n}`)
  }
  await asUser(sam, async () => {
    const shows = await q(`select id from shows`)
    check('sam sees showA (staffed) and showA2 (assigned) and nothing else',
      shows.length === 2 && shows.some(s => s.id === showA.id) && shows.some(s => s.id === showA2.id), JSON.stringify(shows))
    const tcs = await q(`select id from timecards where show_id=$1`, [showA.id])
    check('on showA sam sees only their own timecard', tcs.length === 1 && tcs[0].id === tcSam.id, JSON.stringify(tcs))
    const pun = await q(`select id from punches where show_id=$1`, [showA.id])
    check('and only their own punches', pun.length === 1 && pun[0].id === punchSam.id, JSON.stringify(pun))
    const rates = await q(`select count(*)::int n from timecard_day_rates where show_id=$1`, [showA.id])
    check('and no rates', rates[0].n === 0, `${rates[0].n}`)

    const own = await probe(`update punches set punched_at=now() where id=$1`, [punchSam.id])
    check('sam can change their own punch', own.ok && own.n === 1, own.ok ? `${own.n} rows` : own.code)
    const ins = await probe(`insert into punches (timecard_id, punch_type, punched_at, source) values ($1,'meal_out',now(),'crew')`, [tcSam.id])
    check('and add one', ins.ok && ins.n === 1, ins.ok ? '' : ins.code)
    const other = await probe(`update punches set punched_at=now() where id=$1`, [punchA.id])
    check("but not somebody else's on the same show", !other.ok || other.n === 0, other.ok ? `${other.n} rows` : '')
    const flag = await probe(`update timecards set is_travel_day=true where id=$1`, [tcSam.id])
    check('and cannot change their own timecard flags', !flag.ok || flag.n === 0, flag.ok ? `${flag.n} rows` : '')

    const a2 = await q(`select count(*)::int n from timecards where show_id=$1`, [showA2.id])
    check('on showA2 (assigned) sam sees every timecard', a2[0].n === 1, `${a2[0].n}`)
    const pm = await q(`select count(*)::int n from my_pm_show_ids() f where f = $1`, [showA2.id])
    const notPm = await q(`select count(*)::int n from my_pm_show_ids() f where f = $1`, [showA.id])
    check('my_pm_show_ids() says PM on showA2, not on showA', pm[0].n === 1 && notPm[0].n === 0, `${pm[0].n} ${notPm[0].n}`)
  })
  // Declining removes access; unlinking removes access.
  await q(`update timecards set booking_status='declined' where id=$1`, [tcSam.id])
  await asUser(sam, async () => {
    const s = await q(`select count(*)::int n from shows where id=$1`, [showA.id])
    check('a declined booking takes the show away', s[0].n === 0, `${s[0].n}`)
  })
  await q(`update timecards set booking_status='confirmed' where id=$1`, [tcSam.id])
  await q(`update crew_members set profile_id=null where id=$1`, [samCrewA.id])
  await asUser(sam, async () => {
    const s = await q(`select count(*)::int n from shows where id=$1`, [showA.id])
    check('unlinking takes the show away', s[0].n === 0, `${s[0].n}`)
  })
  await q(`select relink_crew_member($1)`, [samCrewA.id])
  await asUser(sam, async () => {
    const s = await q(`select count(*)::int n from shows where id=$1`, [showA.id])
    check('relinking gives it back', s[0].n === 1, `${s[0].n}`)
  })
  // Unchanged for everyone else.
  await asUser(alice, async () => {
    const tcs = await q(`select count(*)::int n from timecards where show_id=$1`, [showA.id])
    check('an admin still sees every timecard on showA', tcs[0].n >= 2, `${tcs[0].n}`)
  })
  await asUser(dave, async () => {
    const tcs = await q(`select count(*)::int n from timecards where show_id=$1`, [showA.id])
    check('an assigned PM still sees every timecard on showA', tcs[0].n >= 2, `${tcs[0].n}`)
  })
  await asUser(carol, async () => {
    const tcs = await q(`select count(*)::int n from timecards where show_id=$1`, [showA.id])
    check('a view-only member (sees all shows) still sees every timecard', tcs[0].n >= 2, `${tcs[0].n}`)
  })

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
  //
  // Since 0010 a pointer that doesn't resolve falls back to the caller's own
  // oldest live membership, so the assertion is NOT "returns null" — that was an
  // implementation detail. What matters is that pointing at someone else's
  // company never yields THAT company's data.
  await q(`update profiles set active_organization_id=$2 where id=$1`, [alice, orgB])
  await asUser(alice, async () => {
    const [r] = await q(`select my_organization_id()::text o`)
    check('pointing at a company you are not in never resolves to it', r.o !== orgB, `resolved to orgB!`)
    check('it falls back to a company you do belong to', r.o === orgA, `${r.o}`)
    const shows = await q(`select name from shows where name in ('A Show','B Show')`)
    check('and B\'s shows stay invisible', !shows.some(x => x.name === 'B Show'), JSON.stringify(shows))
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

  console.log('\n=== the rate limiter (0025) ===')
  // Owner connection: the counter itself. A fresh key so reruns never collide.
  const rlKey = `${TAG}-rl`
  const hits: boolean[] = []
  for (let i = 0; i < 4; i++) hits.push((await q(`select rate_limit_hit($1, 3, 600) as ok`, [rlKey]))[0].ok)
  check('allows up to the limit, then refuses', JSON.stringify(hits) === '[true,true,true,false]', JSON.stringify(hits))
  await q(`update rate_limits set window_start = now() - interval '11 minutes' where key = $1`, [rlKey])
  const again = (await q(`select rate_limit_hit($1, 3, 600) as ok`, [rlKey]))[0].ok
  check('and starts a fresh window once the old one has lapsed', again === true, `${again}`)
  await q(`delete from rate_limits where key = $1`, [rlKey])
  // Only the API routes (service role) may drive it. A browser session holds
  // the anon key, and this is what stops it burning somebody else's quota.
  await asUser(alice, async () => {
    const r = await probe(`select rate_limit_hit($1, 3, 600)`, [rlKey])
    check('a signed-in session cannot call it', !r.ok && r.code === '42501', r.ok ? 'it could' : r.code)
    const t = await probe(`select count(*) from rate_limits`)
    check('nor read the counters', !t.ok || (await q(`select count(*)::int n from rate_limits`))[0].n === 0, t.ok ? 'readable' : t.code)
  })

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
  // Assignments first: dave's row points at showA, and this must not depend on
  // whether that FK cascades.
  await q(`delete from show_assignments where organization_id = any($1)`, [created.orgs])
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
