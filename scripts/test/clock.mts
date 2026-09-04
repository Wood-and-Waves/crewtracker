// Crew clock link tests — pure, no database.
//
//   npm run test:clock
//
// WHY
// ---
// The expiry rule here deliberately DIFFERS from the booking-invite rule, and
// that is exactly the kind of difference somebody later "makes consistent"
// without realising it breaks the feature. A booking request is answered once,
// soon, so capping it at 30 days limits the blast radius of a leaked link. A
// clock link is used every day OF the show, so the same cap would expire every
// link for a show booked two months out before anybody ever clocked in.
//
// The Slack block is tested for what it must NOT contain as much as what it
// must: Slack does not render markdown links, so a bare URL is the only format
// that survives the paste.

import { clockUrl, clockLinkExpiry, buildSlackList, type ClockLinkRow } from '../../lib/clockLinks.ts'
import { getChronologyError, isEligibleForBatch, type Punch } from '../../lib/punches.ts'

let pass = 0, fail = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  a === e ? (pass++, console.log(`  ✓ ${name}`))
          : (fail++, console.log(`  ✗ ${name}\n      expected ${e}, got ${a}`))
}

console.log('\nclockUrl')
check('joins origin and token',
  clockUrl('https://crewtracker.app', 'abc'), 'https://crewtracker.app/clock/abc')
check('tolerates a trailing slash rather than doubling it',
  clockUrl('https://crewtracker.app/', 'abc'), 'https://crewtracker.app/clock/abc')
check('carries a preview origin through unchanged',
  clockUrl('https://crewtracker-git-scheduling-crew-tracker.vercel.app', 'abc'),
  'https://crewtracker-git-scheduling-crew-tracker.vercel.app/clock/abc')

console.log('\nclockLinkExpiry')
// Exact instants, not date fragments: the whole point is that the answer does
// NOT depend on the machine running this, so a date-only assertion would pass
// on a Mac in Chicago and hide the UTC-server bug entirely.
check('6am the morning after, in the show\'s zone (Chicago, CDT = UTC-5)',
  clockLinkExpiry('2026-09-10', 'America/Chicago'), '2026-09-11T11:00:00.000Z')
// The load-bearing case. Computing this in UTC would give 2026-09-11T00:00Z,
// which is 5pm on the show's LAST DAY in California — every link dead before
// wrap.
check('a Los Angeles show does not expire before its own last night',
  clockLinkExpiry('2026-09-10', 'America/Los_Angeles'), '2026-09-11T13:00:00.000Z')
check('east of UTC works too (Tokyo, UTC+9)',
  clockLinkExpiry('2026-09-10', 'Asia/Tokyo'), '2026-09-10T21:00:00.000Z')
check('crosses a month boundary',
  clockLinkExpiry('2026-09-30', 'America/Chicago'), '2026-10-01T11:00:00.000Z')
check('crosses a year boundary, and CST is UTC-6 in January',
  clockLinkExpiry('2026-12-31', 'America/Chicago'), '2027-01-01T12:00:00.000Z')
// NOT the booking-invite min(30 days, …) rule.
check('a show a year out still gets a link that lasts until the show',
  clockLinkExpiry('2027-06-01', 'America/Chicago'), '2027-06-02T11:00:00.000Z')

console.log('\nbuildSlackList')
const rows: ClockLinkRow[] = [
  { crewMemberId: '1', name: 'Avery Ferreira', token: 'tok-a', revokedAt: null },
  { crewMemberId: '2', name: 'Casey Delgado', token: 'tok-b', revokedAt: null },
]
const text = buildSlackList('Northwind', rows, 'https://crewtracker.app')
check('one line per person, bare URL',
  text.includes('Avery Ferreira: https://crewtracker.app/clock/tok-a'), true)
check('no markdown — Slack would paste the brackets literally',
  /\[.*\]\(.*\)/.test(text), false)
check('tells them the link is theirs to keep',
  text.includes('bookmark it'), true)
check('nobody missing, so no missing heading', text.includes('No link yet'), false)

const withGaps = buildSlackList('Northwind', [
  ...rows,
  { crewMemberId: '3', name: 'Rowan Aoki', token: null, revokedAt: null },
  { crewMemberId: '4', name: 'Quinn Whitfield', token: 'tok-d', revokedAt: '2026-09-01T00:00:00Z' },
], 'https://crewtracker.app')
// Surfaced, not silently dropped: a PM copying this must be able to see who
// cannot clock in, rather than finding out on site.
check('names people with no link', withGaps.includes('Rowan Aoki'), true)
check('treats a revoked link as no link', withGaps.includes('Quinn Whitfield'), true)
check('a revoked token is never printed as a usable URL',
  withGaps.includes('clock/tok-d'), false)

// ---------------------------------------------------------------------------
// The rule the PUBLIC punch route has to compose, and the reason it is two
// checks and not one.
//
// This is a regression test for a real bug: /api/clock/punch originally called
// getChronologyError alone, and accepted an M1 In from somebody who had never
// gone to lunch. Chronology only orders the punches that EXIST — with no M1
// Out there is no earlier time to contradict, so it passes. "The previous
// punch must exist" is a SEPARATE rule, and isEligibleForBatch is where this
// app already keeps it.
//
// None of this is enforced by the database: punches has no chronology trigger
// and no uniqueness on (timecard_id, punch_type). A signed-in PM gets these
// rules from the tracker UI. An unauthenticated stranger gets them only if the
// route applies them itself.
console.log('\nserver-side punch guards')

const at = (iso: string, type: string): Punch =>
  ({ id: type, punch_type: type as Punch['punch_type'], punched_at: iso })

const started = [at('2026-09-04T13:00:00Z', 'start')]

// The bug, stated as a test: chronology alone says yes.
check('chronology ALONE waves through M1 In with no M1 Out',
  getChronologyError(new Date('2026-09-04T18:00:00Z'), 'meal_in', started), null)
// Eligibility is what catches it.
check('eligibility catches the missing M1 Out',
  isEligibleForBatch(started, false, 'meal_in'), false)
check('and allows the punch that really is next',
  isEligibleForBatch(started, false, 'meal_out'), true)

check('cannot wrap before starting',
  isEligibleForBatch([], false, 'end'), false)
check('can start from nothing',
  isEligibleForBatch([], false, 'start'), true)
check('no punches at all on a travel day',
  isEligibleForBatch(started, true, 'meal_out'), false)

const wrapped = [...started, at('2026-09-04T22:00:00Z', 'end')]
check('no meal punches after wrap',
  isEligibleForBatch(wrapped, false, 'meal_out'), false)

// Chronology still does the job eligibility cannot: ordering the times.
check('a lunch that ends before it starts is refused',
  getChronologyError(new Date('2026-09-04T12:00:00Z'), 'meal_in',
    [...started, at('2026-09-04T18:00:00Z', 'meal_out')]),
  'M1 In must be after M1 Out.')
check('and a start after the wrap is refused',
  getChronologyError(new Date('2026-09-04T23:00:00Z'), 'start', wrapped),
  'Start must be before Wrap.')

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
