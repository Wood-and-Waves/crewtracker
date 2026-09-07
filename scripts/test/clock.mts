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

import { clockUrl, clockLinkExpiry, isClockLinkExpired, buildSlackList, type ClockLinkRow } from '../../lib/clockLinks.ts'
import { getChronologyError, isEligibleForBatch, roundWallTime, clearBlockedReason, type Punch } from '../../lib/punches.ts'
import { punchRefusal } from '../../lib/clockPunch.ts'

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

// ---------------------------------------------------------------------------
// Snapping a crew-picked time to the company's grid.
//
// This is NOT the rounding calculateNetHours does. That one ceilings a
// finished day's total net minutes; this one moves the punch itself. Same org
// setting, different operation, and they are not interchangeable — 8:07→17:52
// billed as a duration is 8.75h at a 15-minute grid, but snapped to 8:00→18:00
// it is 9.0h. Anyone "unifying" them should read roundWallTime's header first.
console.log('\ncrew punch rounding')

check('exact-minute orgs are left alone', roundWallTime('08:07', 1), { timeStr: '08:07', dayOffset: 0 })
check('0 is treated as exact, not as a divide-by-zero', roundWallTime('08:07', 0), { timeStr: '08:07', dayOffset: 0 })

// ALWAYS UP, never nearest. 08:07 and 08:14 both go to 08:15 — under nearest
// rounding the first would have gone back to 08:00.
check('one minute past the mark still goes to the NEXT mark',
  roundWallTime('08:01', 15), { timeStr: '08:15', dayOffset: 0 })
check('08:07 rounds UP, not back to 08:00',
  roundWallTime('08:07', 15), { timeStr: '08:15', dayOffset: 0 })
check('08:14 rounds up', roundWallTime('08:14', 15), { timeStr: '08:15', dayOffset: 0 })
check('already on the grid does NOT jump a mark',
  roundWallTime('08:15', 15), { timeStr: '08:15', dayOffset: 0 })
check('midnight is on the grid and stays put',
  roundWallTime('00:00', 15), { timeStr: '00:00', dayOffset: 0 })
check('carries into the next hour', roundWallTime('08:53', 15), { timeStr: '09:00', dayOffset: 0 })

check('half-hour grid rounds up', roundWallTime('17:12', 30), { timeStr: '17:30', dayOffset: 0 })
check('half-hour grid, just past the hour', roundWallTime('17:01', 30), { timeStr: '17:30', dayOffset: 0 })
check('half-hour grid, on the mark', roundWallTime('17:30', 30), { timeStr: '17:30', dayOffset: 0 })

// The case that silently produces an invalid "24:00" if dayOffset is dropped.
check('23:46 at a quarter grid becomes midnight TOMORROW',
  roundWallTime('23:46', 15), { timeStr: '00:00', dayOffset: 1 })
check('23:45 is on the grid, so it stays today',
  roundWallTime('23:45', 15), { timeStr: '23:45', dayOffset: 0 })
check('23:31 at a half-hour grid rolls over too',
  roundWallTime('23:31', 30), { timeStr: '00:00', dayOffset: 1 })

check('garbage in is returned untouched rather than becoming 00:00',
  roundWallTime('not-a-time', 15), { timeStr: 'not-a-time', dayOffset: 0 })

// ---------------------------------------------------------------------------
// Expiry is DERIVED from the show, never read from clock_links.expires_at.
//
// Regression test for a real bug: `add_show_day` extends shows.end_date, so a
// link minted while the show ran Sep 4–8 kept an expiry of Sep 9 even after the
// show grew to Sep 10. The whole crew would have been locked out on the last
// two days — the days they most need to clock out — and told to go ask their PM.
console.log('\nlink expiry derives from the show')

const tz = 'America/Chicago'
const during = new Date('2026-09-06T15:00:00Z')

check('live while the show is running', isClockLinkExpired('2026-09-08', tz, during), false)
check('live on the show\'s own last day',
  isClockLinkExpired('2026-09-08', tz, new Date('2026-09-08T23:00:00Z')), false)
check('still live at 3am after the last night (expiry is 6am the morning after)',
  isClockLinkExpired('2026-09-08', tz, new Date('2026-09-09T08:00:00Z')), false)
check('expired once the morning after has passed',
  isClockLinkExpired('2026-09-08', tz, new Date('2026-09-09T12:00:00Z')), true)

// The bug itself: a show that grew must keep its links alive.
const mintedFor = '2026-09-08'          // what expires_at was computed from
const showGrewTo = '2026-09-10'          // after add_show_day ran twice
const lastDay = new Date('2026-09-10T20:00:00Z')
check('the STORED expiry would already have lapsed',
  new Date(clockLinkExpiry(mintedFor, tz)) <= lastDay, true)
check('but the derived one is still live, because the show grew',
  isClockLinkExpired(showGrewTo, tz, lastDay), false)

// ---------------------------------------------------------------------------
// Crew may clear a punch they entered themselves — but not one that a later
// punch depends on. Deleting from the middle of a day is what would leave
// mealBreakPairs() reading a lunch that ended without starting.
console.log('\nclearing a punch')

const full = [
  at('2026-09-05T13:00:00Z', 'start'),
  at('2026-09-05T18:00:00Z', 'meal_out'),
  at('2026-09-05T19:00:00Z', 'meal_in'),
  at('2026-09-05T23:00:00Z', 'end'),
]

check('the wrap can always go — nothing depends on it',
  clearBlockedReason(full, 'end'), null)
check('M1 In can go once it is the last meal punch',
  clearBlockedReason(full, 'meal_in'), null)
check('M1 Out cannot go while M1 In still needs it',
  clearBlockedReason(full, 'meal_out'), 'Clear M1 In first — it needs M1 Out.')
// Names the FIRST dependent in punch order, not all of them — clearing a start
// on a full day would orphan M1 Out, M1 In and Wrap, and listing three things
// to do is worse than naming the next one.
check('start cannot go while anything still needs it',
  clearBlockedReason(full, 'start'), 'Clear M1 Out first — it needs Start.')

const startOnly = [at('2026-09-05T13:00:00Z', 'start')]
check('a lone start clears fine', clearBlockedReason(startOnly, 'start'), null)

const startAndOut = [full[0], full[1]]
check('M1 Out clears once M1 In is gone', clearBlockedReason(startAndOut, 'meal_out'), null)
check('start still blocked by an M1 Out that needs it',
  clearBlockedReason(startAndOut, 'start'), 'Clear M1 Out first — it needs Start.')

console.log('\n=== punchRefusal: the one crew-punch decision both routes share ===')
{
  const P = (type: string, at: string, source: 'staff' | 'crew' = 'crew') =>
    ({ id: type, punch_type: type as any, punched_at: at, source })
  const started = [P('start', '2026-09-01T13:00:00Z')]
  check('a fresh start is allowed', punchRefusal([], false, null, 'start', undefined), null)
  check('M1 In without M1 Out is refused (the two-check rule)',
    typeof punchRefusal(started, false, null, 'meal_in', undefined), 'string')
  check('a travel day refuses everything', typeof punchRefusal([], true, null, 'start', undefined), 'string')
  check('a cancelled day refuses everything', typeof punchRefusal([], false, 'cancelled', 'start', undefined), 'string')
  check('a no-show day refuses everything', typeof punchRefusal([], false, 'no_show', 'start', undefined), 'string')
  check('correcting your own punch skips the order rule',
    punchRefusal(started, false, null, 'start', started[0]), null)
  const pmStart = [P('start', '2026-09-01T13:00:00Z', 'staff')]
  check('a PM-entered punch cannot be changed',
    typeof punchRefusal(pmStart, false, null, 'start', pmStart[0]), 'string')
  check('wrap after start is allowed', punchRefusal(started, false, null, 'end', undefined), null)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
