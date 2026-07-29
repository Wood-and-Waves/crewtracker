// Fill a DEVELOPMENT database with realistic fake data.
//
//   npm run db:seed
//   npm run db:seed -- --admin-email you@example.com
//
// Works against whatever DATABASE_URL points at, so it suits any dev setup —
// a second Supabase project, a second organization, or a local stack.
//
// NEVER a copy of production. Real crew names, phone numbers, emails and pay
// rates belong to Dan's customers; a development database is exactly the place
// they should not end up. Everything below is generated.
//
// SAFETY: refuses outright to run against the production project. No override
// flag — a seed script that can be pointed at production is a loaded gun, and
// "I'll be careful" is not a safeguard. To reseed production (you don't want
// to), you'd have to edit this file, which is enough of a speed bump.

import pg from 'pg'
import { randomUUID } from 'node:crypto'

pg.types.setTypeParser(1700, (v) => parseFloat(v))

const PRODUCTION_REF = 'nfrvxkwemtittrqboebl'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
if (url.includes(PRODUCTION_REF)) {
  console.error(`
REFUSING TO RUN.

DATABASE_URL points at the production project (${PRODUCTION_REF}). This script
creates fake organizations, crew and shows — it must only ever run against a
development database.

Point DATABASE_URL at your dev project and try again.
`)
  process.exit(1)
}

const adminEmailArg = process.argv.indexOf('--admin-email')
const adminEmail = adminEmailArg > -1 ? process.argv[adminEmailArg + 1] : null
// Attaching a login and generating data are separate jobs. Without this, coming
// back to link an account would silently seed a whole second organization.
const attachOnly = process.argv.includes('--attach-only')
const force = process.argv.includes('--force')
// Wipe this org's generated data and rebuild it. Dev-only by construction (the
// production guard above already ran), and the reason it exists is that a
// scheduling view is judged against the SHAPE of a season — so the dataset needs
// to be re-rollable as the design changes, not a one-off nobody dares recreate.
const reset = process.argv.includes('--reset')

const FIRST = [
  'Alex','Jordan','Sam','Riley','Casey','Morgan','Avery','Quinn','Rowan','Skyler','Emerson','Harper',
  'Devon','Marlowe','Sasha','Toni','Bex','Kai','Noor','Ines','Rafa','Bo','Wren','Ola',
]
const LAST = [
  'Reyes','Okafor','Lindqvist','Marchetti','Delgado','Novak','Ferreira','Whitfield','Aoki','Bergström','Castellanos','Idris',
  'Nakamura','Oyelaran','Vasquez','Hollis','Petrov','Mwangi','Halvorsen','Dubois','Santoro','Ellery','Kovac','Amari',
]
const ROLES = ['A1','A2','L1','V1','Camera Operator','Stagehand','Production Manager','Carpenter']
const AV_ROLES = [
  'A1','A2','Assistant Stage Manager','BO Tech','Camera Operator','Carpenter','Creative Director',
  'Director','Executive Producer','Graphics Operator','Head Rigger','L1','L2','LD','LED Technician',
  'Lighting Designer','Master Electrician','Motors','Production Manager','Projectionist','RF Technician',
  'Riggers','Show Caller','Stage Manager','Stagehand','Systems Engineer','Technical Director',
  'Teleprompter Operator','V1','V2','Video Director',
]

const client = new pg.Client({ connectionString: url })
await client.connect()

async function seed() {
  if (reset) {
    // Order matters: children first. Memberships and profiles are left alone so
    // the logins attached to this org survive a reseed.
    console.log('Resetting generated data…')
    for (const sql of [
      // Unlock first. block_writes_when_finalized refuses every timecard and
      // punch write on a finalized show — including the deletes below — so a
      // reset would otherwise fail on any show that had been signed off, which
      // is exactly the state testing leaves behind.
      `update shows set finalized_at = null, finalized_by = null where finalized_at is not null`,
      `delete from punches where timecard_id in (select t.id from timecards t
         join rooms r on r.id=t.room_id join work_days w on w.id=r.work_day_id)`,
      `delete from timecards`, `delete from rooms`, `delete from work_days`,
      `delete from payroll_rulesets`, `delete from shows`,
      `delete from rate_cards`, `delete from crew_members`, `delete from av_roles`,
      `delete from payroll_presets`, `delete from invitations`,
    ]) await client.query(sql)
    // Keep the organization row so memberships and active_organization_id survive.
    const { rows: [{ n: orgs }] } = await client.query('select count(*)::int as n from organizations')
    if (orgs > 0) {
      const { rows: [o] } = await client.query('select id from organizations order by created_at limit 1')
      await seedInto(o.id)
      console.log('\nDone — existing organization refilled.')
      process.exit(0)
    }
  }

  const { rows: [{ n }] } = await client.query('select count(*)::int as n from organizations')
  if (n > 0 && !force) {
    console.error(`
This database already has ${n} organization(s). Seeding again would add another
complete set rather than replacing what is there.

  To wipe and rebuild this org's data:   npm run db:seed -- --reset
  To link a login to the existing data:  npm run db:seed -- --attach-only --admin-email you@example.com
  To add a second org anyway:            npm run db:seed -- --force
`)
    process.exit(1)
  }

  console.log('Seeding development data…\n')

  const orgId = randomUUID()
  await client.query(
    `insert into organizations (id, name, timecard_rounding_minutes) values ($1, $2, 1)`,
    [orgId, 'Northwind Staging Co.'])
  console.log('  organization  Northwind Staging Co.')

  await seedInto(orgId)
  return orgId
}

// Everything that can be regenerated for an organization that already exists.
// Split out so --reset can refill in place, leaving the organization row (and
// therefore every membership and active_organization_id pointing at it) intact.
async function seedInto(orgId) {
  await client.query(
    `insert into av_roles (organization_id, name, sort_order)
     select $1, name, ordinality from unnest($2::text[]) with ordinality as t(name, ordinality)`,
    [orgId, AV_ROLES])
  console.log(`  av_roles      ${AV_ROLES.length}`)

  // Crew, each with a rate card so pay figures are exercised.
  const crew = []
  for (let i = 0; i < FIRST.length; i++) {
    const name = `${FIRST[i]} ${LAST[i]}`
    const id = randomUUID()
    await client.query(
      `insert into crew_members (id, organization_id, full_name, email, phone)
       values ($1,$2,$3,$4,$5)`,
      [id, orgId, name, `${FIRST[i].toLowerCase()}@example.test`, `555010${String(i).padStart(2,'0')}`])
    const role = ROLES[i % ROLES.length]
    const rate = [450, 500, 550, 600, 650][i % 5]
    await client.query(
      `insert into rate_cards (crew_member_id, role, day_rate) values ($1,$2,$3)`, [id, role, rate])
    crew.push({ id, name, role, rate })
  }
  console.log(`  crew_members  ${crew.length} (with rate cards)`)

  // A season of work, not two demo shows.
  //
  // The schedule view is judged on whether it makes a messy month legible, so
  // this generates one: nine shows over about ten weeks, several running at the
  // same time, in three timezones, with crew deliberately shared between
  // concurrent shows so real double-bookings exist to find. Two shows sharing a
  // date is normal in this business; the same person on both is the mistake the
  // calendar is meant to surface, and it cannot be evaluated against data where
  // it never happens.
  //
  // `crewFrom` / `crewTo` index into the crew array, and the ranges OVERLAP
  // between shows that run concurrently — that is what manufactures the clashes.
  const today = new Date()
  const iso = (d) => d.toISOString().slice(0, 10)
  const shift = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d }

  // name, venue, city, timezone, startOffset, days, rooms, crewFrom, crewTo, punches
  const SHOWS = [
    ['Meridian Sales Kickoff',   'Riverfront Convention Center', 'Chicago, IL',      'America/Chicago',     -24, 4, ['Main Stage','Breakout A','Breakout B'],  0,  9, 'full'],
    ['Halcyon Investor Day',     'The Gramercy',                 'New York, NY',     'America/New_York',    -22, 2, ['Ballroom'],                              7, 12, 'full'],
    ['Ardent Product Launch',    'Pier 27',                      'San Francisco, CA','America/Los_Angeles', -12, 3, ['Main Stage','Demo Hall'],                2, 10, 'full'],
    ['Vantage Leadership Summit','Riverfront Convention Center', 'Chicago, IL',      'America/Chicago',      -4, 5, ['Main Stage','Breakout A'],               0,  8, 'partial'],
    ['Cobalt Dealer Meeting',    'Music City Center',            'Nashville, TN',    'America/Chicago',      -2, 4, ['Grand Ballroom','Breakout A'],           6, 14, 'partial'],
    ['Lumen Awards Night',       'The Gramercy',                 'New York, NY',     'America/New_York',      1, 2, ['Ballroom'],                             10, 16, 'none'],
    ['Northwind User Conference','Moscone West',                 'San Francisco, CA','America/Los_Angeles',   6, 5, ['Keynote Hall','Breakout A','Breakout B'],3, 13, 'none'],
    ['Solstice Partner Forum',   'Music City Center',            'Nashville, TN',    'America/Chicago',       9, 3, ['Grand Ballroom'],                       11, 18, 'none'],
    ['Aster Annual Meeting',     'Riverfront Convention Center', 'Chicago, IL',      'America/Chicago',      28, 4, ['Main Stage','Breakout A'],               0, 10, 'none'],
    // Booked but not yet staffed — crewFrom === crewTo, so rooms exist and not
    // one person is on them. A real and common state (the show is sold, the
    // crewing call hasn't happened) and the one the schedule most needs to make
    // visible: without it, "show running, nobody on it" and "show not running"
    // look identical, and the gap you are meant to spot is the one that hides.
    ['Kestrel Regional Roadshow','Pier 27',                      'San Francisco, CA','America/Los_Angeles',   4, 3, ['Main Stage'],                            0,  0, 'none'],
    // PARTLY staffed: three rooms, only enough crew to fill the first. The
    // main stage is covered and the breakouts are not — the most common real
    // state of a show mid-crewing, and the one a schedule has to distinguish
    // from "done". Without it the only states in the data are all-or-nothing,
    // and a cell that says "8" looks equally finished either way.
    ['Beacon Field Summit',      'Moscone West',                 'San Francisco, CA','America/Los_Angeles',   5, 3, ['Main Stage','Breakout A','Breakout B'],  0,  3, 'none'],
  ]

  for (const [name, venue, city, tz, startOffset, days, rooms, crewFrom, crewTo, punches] of SHOWS) {
    const showId = randomUUID()
    await client.query(
      `insert into shows (id, organization_id, name, venue, city_state, start_date, end_date,
                          timezone_identifier, show_financials, client_company)
       values ($1,$2,$3,$4,$5,$6,$7,$8, true, $9)`,
      [showId, orgId, name, venue, city, iso(shift(startOffset)),
       iso(shift(startOffset + days - 1)), tz, name.split(' ')[0] + ' Corp'])

    await client.query(
      `insert into payroll_rulesets (show_id, overtime_after_hours, double_time_enabled,
                                     double_time_after_hours, travel_rate, meal_penalty_enabled,
                                     meal_penalty_grace_period, minimum_meal_break_enabled,
                                     minimum_meal_break_minutes, meal_break_deduction_cap,
                                     short_turn_penalty_enabled, short_turn_rest_hours)
       values ($1, 10, true, 12, 'halfDay', true, 6, true, 30, 60, true, 10)`, [showId])

    const onShow = crew.slice(crewFrom, crewTo)

    for (let d = 0; d < days; d++) {
      const dayDate = iso(shift(startOffset + d))
      const { rows: [wd] } = await client.query(
        `insert into work_days (show_id, date, day_number) values ($1,$2,$3) returning id`,
        [showId, dayDate, d + 1])

      for (const [ri, roomName] of rooms.entries()) {
        const { rows: [room] } = await client.query(
          `insert into rooms (work_day_id, name, created_at)
           values ($1,$2,$3::timestamptz + ($4 * interval '1 second')) returning id`,
          [wd.id, roomName, dayDate, ri + 1])

        // Split this show's crew between its rooms, so a room has a plausible
        // 3–5 people rather than everyone being everywhere.
        const perRoom = Math.max(3, Math.ceil(onShow.length / rooms.length))
        const assigned = onShow.slice(ri * perRoom, ri * perRoom + perRoom)
        let posOrder = 0
        for (const c of assigned) {
          // Every booking answers a position, because that is how the work
          // really goes: somebody decides the room needs an A1 and then somebody
          // fills it. Seeding crew without positions produced shows that read
          // "no positions set", which is not a state a real show is ever in.
          const { rows: [pos] } = await client.query(
            `insert into crew_call_positions (room_id, role, sort_order) values ($1,$2,$3) returning id`,
            [room.id, c.role, posOrder++])
          const { rows: [tc] } = await client.query(
            `insert into timecards (room_id, crew_member_id, crew_member_name, role, day_rate, call_position_id, booking_status)
             values ($1,$2,$3,$4,$5,$6,'confirmed') returning id`,
            [room.id, c.id, c.name, c.role, c.rate, pos.id])

          // 'full' = every day punched, 'partial' = only days already past.
          const isPast = startOffset + d < 0
          if (punches === 'full' || (punches === 'partial' && isPast)) {
            for (const [type, at] of [
              ['start', '13:00'], ['meal_out', '18:00'], ['meal_in', '18:30'], ['end', '23:30'],
            ]) {
              await client.query(
                `insert into punches (timecard_id, punch_type, punched_at) values ($1,$2,$3)`,
                [tc.id, type, `${dayDate}T${at}:00Z`])
            }
          }
        }

        // Shows that have not started yet are still being crewed: leave a
        // couple of positions open so the list shows real progress rather than
        // every show sitting at 100%.
        if (punches === 'none') {
          // A room with nobody assigned still gets a call — that is exactly the
          // "sold but not yet crewed" state Kestrel exists to demonstrate, and
          // without positions it reads as "not staffed", which is a different
          // and much rarer situation.
          const open = assigned.length === 0 ? 4 : ri === 0 ? 2 : 1
          for (let k = 0; k < open; k++) {
            await client.query(
              `insert into crew_call_positions (room_id, role, sort_order) values ($1,$2,$3)`,
              [room.id, ROLES[(ri + k) % ROLES.length], posOrder++])
          }
        }
      }
    }
    console.log(`  show          ${name.padEnd(28)} ${iso(shift(startOffset))} +${days}d  ${rooms.length} room(s)  ${punches}`)
  }

  // Report the clashes this produced, so it is obvious there is something for
  // the calendar to find rather than having to go looking.
  const { rows: clashes } = await client.query(`
    select w.date::text as date, t.crew_member_name, count(distinct w.show_id) as shows
    from timecards t
    join rooms r     on r.id = t.room_id
    join work_days w on w.id = r.work_day_id
    group by w.date, t.crew_member_name
    having count(distinct w.show_id) > 1
    order by w.date, t.crew_member_name`)
  console.log(`\n  double-bookings created: ${clashes.length}`)
  for (const c of clashes.slice(0, 6)) console.log(`    ${c.date}  ${c.crew_member_name} — ${c.shows} shows`)
  if (clashes.length > 6) console.log(`    …and ${clashes.length - 6} more`)
}

// Attach an existing login to an org as a full admin. Auth users are created by
// signing up (or via the dashboard's Add User), never here — GoTrue owns that
// table and hand-inserting rows is a good way to get an account that half works.
// The profiles row itself is created by the on_auth_user_created trigger; if
// that trigger is missing, this reports "no profile found" rather than failing
// mysteriously later. See scripts/sql/out-of-schema.sql.
async function attachAdmin(orgId, email) {
  const { rowCount } = await client.query(
    `update profiles set organization_id = $1, base_role = 'admin',
            can_manage_users = true, can_manage_crew_directory = true, can_import_crew = true,
            can_view_crew_contacts = true, can_create_shows = true, can_edit_all_shows = true,
            can_archive_shows = true, can_duplicate_shows = true, can_edit_timecards = true,
            can_approve_timecards = true, can_view_pay_rates = true, can_edit_pay_rates = true,
            can_manage_rulesets = true, can_view_reports = true, can_export_reports = true,
            can_send_reports = true, view_only = false
     where email = $2`, [orgId, email])
  console.log(rowCount
    ? `  admin         ${email} attached with full permissions`
    : `  admin         NO PROFILE for ${email} — create the login first (dev dashboard -> Authentication -> Add user)`)
}

try {
  if (attachOnly) {
    if (!adminEmail) {
      console.error('--attach-only needs --admin-email you@example.com')
      process.exit(1)
    }
    const { rows } = await client.query('select id, name from organizations order by created_at limit 2')
    if (!rows.length) {
      console.error('No organization to attach to. Run `npm run db:seed` first.')
      process.exit(1)
    }
    if (rows.length > 1) console.log(`  (multiple orgs present; using the oldest: ${rows[0].name})`)
    console.log(`Attaching to "${rows[0].name}"…`)
    await attachAdmin(rows[0].id, adminEmail)
  } else {
    const orgId = await seed()
    if (adminEmail) await attachAdmin(orgId, adminEmail)
    else {
      console.log('\n  No --admin-email given. Create a login in the dashboard, then run')
      console.log('    npm run db:seed -- --attach-only --admin-email you@example.com')
    }
  }
  console.log('\nDone.')
} catch (e) {
  console.error('\nFailed:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
