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

const FIRST = ['Alex','Jordan','Sam','Riley','Casey','Morgan','Avery','Quinn','Rowan','Skyler','Emerson','Harper']
const LAST  = ['Reyes','Okafor','Lindqvist','Marchetti','Delgado','Novak','Ferreira','Whitfield','Aoki','Bergström','Castellanos','Idris']
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
  console.log('Seeding development data…\n')

  const orgId = randomUUID()
  await client.query(
    `insert into organizations (id, name, timecard_rounding_minutes) values ($1, $2, 1)`,
    [orgId, 'Northwind Staging Co.'])
  console.log('  organization  Northwind Staging Co.')

  await client.query(
    `insert into av_roles (organization_id, name, sort_order)
     select $1, name, ordinality from unnest($2::text[]) with ordinality as t(name, ordinality)`,
    [orgId, AV_ROLES])
  console.log(`  av_roles      ${AV_ROLES.length}`)

  // Crew, each with a rate card so pay figures are exercised.
  const crew = []
  for (let i = 0; i < 12; i++) {
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

  // Two shows: one mid-run with punches, one upcoming and empty — enough to
  // exercise every status badge and both the payroll and empty-state paths.
  const today = new Date()
  const iso = (d) => d.toISOString().slice(0, 10)
  const shift = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d }

  for (const [name, startOffset, days, withPunches] of [
    ['Northwind Sales Kickoff', -2, 4, true],
    ['Q4 Partner Summit', 21, 3, false],
  ]) {
    const showId = randomUUID()
    await client.query(
      `insert into shows (id, organization_id, name, venue, city_state, start_date, end_date,
                          timezone_identifier, show_financials)
       values ($1,$2,$3,$4,$5,$6,$7,'America/Chicago', true)`,
      [showId, orgId, name, 'Riverfront Convention Center', 'Chicago, IL',
       iso(shift(startOffset)), iso(shift(startOffset + days - 1))])

    await client.query(
      `insert into payroll_rulesets (show_id, overtime_after_hours, double_time_enabled,
                                     double_time_after_hours, travel_rate, meal_penalty_enabled,
                                     meal_penalty_grace_period, minimum_meal_break_enabled,
                                     minimum_meal_break_minutes, meal_break_deduction_cap,
                                     short_turn_penalty_enabled, short_turn_rest_hours)
       values ($1, 10, true, 12, 'halfDay', true, 6, true, 30, 60, true, 10)`, [showId])

    for (let d = 0; d < days; d++) {
      const { rows: [wd] } = await client.query(
        `insert into work_days (show_id, date, day_number) values ($1,$2,$3) returning id`,
        [showId, iso(shift(startOffset + d)), d + 1])

      for (const [ri, roomName] of ['Main Stage', 'Breakout A'].entries()) {
        const { rows: [room] } = await client.query(
          `insert into rooms (work_day_id, name, created_at)
           values ($1,$2,$3::timestamptz + ($4 * interval '1 second')) returning id`,
          [wd.id, roomName, iso(shift(startOffset + d)), ri + 1])

        for (const c of crew.slice(ri * 4, ri * 4 + 4)) {
          const { rows: [tc] } = await client.query(
            `insert into timecards (room_id, crew_member_id, crew_member_name, role, day_rate)
             values ($1,$2,$3,$4,$5) returning id`,
            [room.id, c.id, c.name, c.role, c.rate])

          if (withPunches && d < 2) {
            const day = iso(shift(startOffset + d))
            for (const [type, at] of [
              ['start', '13:00'], ['meal_out', '18:00'], ['meal_in', '18:30'], ['end', '23:30'],
            ]) {
              await client.query(
                `insert into punches (timecard_id, punch_type, punched_at) values ($1,$2,$3)`,
                [tc.id, type, `${day}T${at}:00Z`])
            }
          }
        }
      }
    }
    console.log(`  show          ${name} (${days} days${withPunches ? ', punched' : ', not started'})`)
  }

  // Attach an existing login to the org. Auth users are created by signing up in
  // the app, not here — GoTrue owns that table and hand-inserting rows into it is
  // a good way to get an account that half works.
  if (adminEmail) {
    const { rowCount } = await client.query(
      `update profiles set organization_id = $1, base_role = 'admin',
              can_manage_users = true, can_manage_crew_directory = true, can_import_crew = true,
              can_view_crew_contacts = true, can_create_shows = true, can_edit_all_shows = true,
              can_archive_shows = true, can_duplicate_shows = true, can_edit_timecards = true,
              can_approve_timecards = true, can_view_pay_rates = true, can_edit_pay_rates = true,
              can_manage_rulesets = true, can_view_reports = true, can_export_reports = true,
              can_send_reports = true, view_only = false
       where email = $2`, [orgId, adminEmail])
    console.log(rowCount
      ? `\n  admin         ${adminEmail} attached to the org with full permissions`
      : `\n  admin         no profile found for ${adminEmail} — sign up in the app first, then re-run`)
  } else {
    console.log('\n  No --admin-email given. Sign up in the app, then re-run with')
    console.log('    npm run db:seed -- --admin-email you@example.com')
  }
}

try {
  await seed()
  console.log('\nDone.')
} catch (e) {
  console.error('\nSeeding failed:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
