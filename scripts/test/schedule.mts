// Schedule date + grouping tests — pure, no database.
//
//   npm run test:schedule
//
// WHY
// ---
// The schedule is built on calendar-date arithmetic, and this project has twice
// shipped a bug from doing that arithmetic in the wrong frame of reference (the
// tracker's UTC "today", and TimeEntryModal's browser "today"). The DST cases
// below are the third version of that same mistake waiting to happen: adding a
// day in local time crosses a 23- or 25-hour boundary twice a year, which
// duplicates or drops a column in the grid. UTC has no DST, which is why
// addDays uses it.
//
// resolveWindow is tested for the multi-timezone rule specifically: there is no
// single "today" across shows in different zones, and the window must start at
// the EARLIEST of them so nothing that is today somewhere falls off the edge.

import { addDays, dateRange } from '../../lib/datetime.ts'
import { byShowAndDate, coverageFor, crewKey, resolveWindow,
         type ScheduleBooking, type ScheduleShow } from '../../lib/schedule.ts'
import { todayInZone, showStatus } from '../../lib/showStatus.ts'
import { describeDates, buildBookingRequestText } from '../../lib/bookingEmail.ts'

let pass = 0, fail = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  a === e ? (pass++, console.log(`  ✓ ${name}`))
          : (fail++, console.log(`  ✗ ${name}\n      expected ${e}, got ${a}`))
}

console.log('\naddDays')
check('adds a day', addDays('2026-07-28', 1), '2026-07-29')
check('subtracts a day', addDays('2026-07-28', -1), '2026-07-27')
check('zero is identity', addDays('2026-07-28', 0), '2026-07-28')
check('crosses a month end', addDays('2026-07-31', 1), '2026-08-01')
check('crosses a year end', addDays('2026-12-31', 1), '2027-01-01')
check('crosses back over a year start', addDays('2027-01-01', -1), '2026-12-31')
check('leap day exists in 2028', addDays('2028-02-28', 1), '2028-02-29')
check('no leap day in 2026', addDays('2026-02-28', 1), '2026-03-01')
check('adds two weeks', addDays('2026-07-28', 14), '2026-08-11')

// The reason addDays works in UTC. US clocks go forward on 2026-03-08 and back
// on 2026-11-01; doing this sum in local time yields a 23h/25h day and lands on
// the wrong date.
console.log('\naddDays across DST transitions')
check('spring forward, day before', addDays('2026-03-07', 1), '2026-03-08')
check('spring forward, day of', addDays('2026-03-08', 1), '2026-03-09')
check('fall back, day before', addDays('2026-10-31', 1), '2026-11-01')
check('fall back, day of', addDays('2026-11-01', 1), '2026-11-02')
check('spans the whole spring transition', addDays('2026-03-01', 14), '2026-03-15')

console.log('\ndateRange')
check('length matches count', dateRange('2026-07-28', 5).length, 5)
check('starts at start', dateRange('2026-07-28', 3), ['2026-07-28', '2026-07-29', '2026-07-30'])
check('crosses a month boundary', dateRange('2026-07-30', 3), ['2026-07-30', '2026-07-31', '2026-08-01'])
check('a count of one is just the start', dateRange('2026-07-28', 1), ['2026-07-28'])
check('a count of zero is empty', dateRange('2026-07-28', 0), [])
check('a negative count is empty, not a crash', dateRange('2026-07-28', -3), [])

console.log('\ncrewKey')
const fromDirectory = { crewMemberId: 'abc-123', crewName: 'Quinn Whitfield' }
const typedName = { crewMemberId: null, crewName: 'Quinn Whitfield' }
check('directory crew key on their id', crewKey(fromDirectory), 'abc-123')
check('manually-named crew fall back to the name', crewKey(typedName), 'name:quinn whitfield')
check('name fallback ignores case', crewKey({ crewMemberId: null, crewName: 'QUINN WHITFIELD' }), 'name:quinn whitfield')
check('name fallback ignores surrounding space', crewKey({ crewMemberId: null, crewName: '  Quinn Whitfield ' }), 'name:quinn whitfield')
// Deliberate: the same human entered both ways is two keys. Nothing links a
// typed name to a directory row, and guessing they are the same person by name
// would silently merge two different people who share one.
check('an id and a typed name are different keys', crewKey(fromDirectory) === crewKey(typedName), false)

console.log('\nbyShowAndDate')
const b = (showId: string, date: string, crewName: string): ScheduleBooking => ({
  timecardId: `${showId}-${date}-${crewName}`, crewMemberId: null, crewName,
  role: 'A1', isTravelDay: false, roomId: 'r', roomName: 'Main Stage', date, showId,
})
const grouped = byShowAndDate([
  b('s1', '2026-07-28', 'Rowan Aoki'),
  b('s1', '2026-07-28', 'Alex Reyes'),
  b('s1', '2026-07-29', 'Alex Reyes'),
  b('s2', '2026-07-28', 'Bo Santoro'),
])
check('groups by show and date', grouped.get('s1|2026-07-28')?.length, 2)
check('keeps shows apart on the same date', grouped.get('s2|2026-07-28')?.length, 1)
check('keeps dates apart within a show', grouped.get('s1|2026-07-29')?.length, 1)
check('an empty cell is absent, not empty', grouped.get('s2|2026-07-29'), undefined)
// Sorted so the grid does not reshuffle between loads on the database's whim.
check('sorts crew by name inside a cell',
  grouped.get('s1|2026-07-28')?.map(x => x.crewName), ['Alex Reyes', 'Rowan Aoki'])

console.log('\ncoverageFor')
const show = (rooms: { id: string; name: string }[]): ScheduleShow => ({
  id: 's1', name: 'Beacon Field Summit', venue: 'Moscone West', cityState: null,
  timezone: 'America/Los_Angeles', startDate: '2026-08-02', endDate: '2026-08-04',
  finalizedAt: null, dayNumbers: { '2026-08-02': 1 }, roomsByDate: { '2026-08-02': rooms },
})
const threeRooms = show([{ id: 'r1', name: 'Main Stage' }, { id: 'r2', name: 'Breakout A' }, { id: 'r3', name: 'Breakout B' }])
const inRoom = (roomId: string, crewName: string): ScheduleBooking => ({
  timecardId: `${roomId}-${crewName}`, crewMemberId: null, crewName, role: 'A1',
  isTravelDay: false, roomId, roomName: roomId, date: '2026-08-02', showId: 's1',
})

const partly = coverageFor(threeRooms, '2026-08-02', [inRoom('r1', 'Alex'), inRoom('r1', 'Bo')])
check('counts the crew booked', partly.crewCount, 2)
check('counts every room on the day', partly.roomsTotal, 3)
// Two people in ONE room is one room covered, not two. Counting timecards here
// would report the day as better covered than it is.
check('counts rooms with anyone in them, not headcount', partly.roomsStaffed, 1)
check('reports the rooms still to fill', partly.roomsUnstaffed, 2)

const full = coverageFor(threeRooms, '2026-08-02', [inRoom('r1', 'Alex'), inRoom('r2', 'Bo'), inRoom('r3', 'Cass')])
check('a fully covered day has nothing to fill', full.roomsUnstaffed, 0)

const none = coverageFor(threeRooms, '2026-08-02', [])
check('nobody booked still knows how many rooms need filling', none.roomsUnstaffed, 3)
check('nobody booked has no crew', none.crewCount, 0)

// A day whose rooms have not been created yet: the show runs, but there is
// nothing to be short of. Reporting "0 to fill" is right — reporting a negative
// number, or treating it as fully covered, is not.
const noRooms = coverageFor(show([]), '2026-08-02', [])
check('a day with no rooms yet has none to fill', noRooms.roomsUnstaffed, 0)
check('a day with no rooms yet has no total', noRooms.roomsTotal, 0)

// Defensive: a booking naming a room the shows query did not return must never
// produce a negative shortfall.
const stray = coverageFor(show([{ id: 'r1', name: 'Main Stage' }]), '2026-08-02',
  [inRoom('r1', 'Alex'), inRoom('r9', 'Ghost')])
check('a stray room never makes the shortfall negative', stray.roomsUnstaffed, 0)

console.log('\nresolveWindow')
check('defaults to 14 days', resolveWindow({}, ['America/Chicago']).days, 14)
check('honours an explicit length', resolveWindow({ days: '7' }, ['America/Chicago']).days, 7)
check('honours an explicit start', resolveWindow({ start: '2026-07-28' }, ['America/Chicago']).start, '2026-07-28')
check('end is inclusive of the last day',
  resolveWindow({ start: '2026-07-28', days: '14' }, ['America/Chicago']).end, '2026-08-10')
check('a one-day window starts and ends the same day',
  resolveWindow({ start: '2026-07-28', days: '1' }, ['America/Chicago']).end, '2026-07-28')

// Junk in the URL must not produce a broken grid — these are user-editable.
check('rejects a malformed start', resolveWindow({ start: 'yesterday' }, ['UTC']).start, todayInZone('UTC'))
check('rejects a half-formed date', resolveWindow({ start: '2026-7-4' }, ['UTC']).start, todayInZone('UTC'))
check('rejects a non-numeric length', resolveWindow({ days: 'lots' }, ['UTC']).days, 14)
check('rejects zero days', resolveWindow({ days: '0' }, ['UTC']).days, 14)
check('rejects a negative length', resolveWindow({ days: '-5' }, ['UTC']).days, 14)
check('caps an absurd length', resolveWindow({ days: '99999' }, ['UTC']).days, 14)
check('allows the documented maximum', resolveWindow({ days: '92' }, ['UTC']).days, 92)

// The multi-timezone rule. Kiritimati (UTC+14) and Niue (UTC-11) are 25 hours
// apart and are almost always on different calendar dates, so this pins the
// "earliest today wins" behaviour rather than restating it.
const spread = ['Pacific/Kiritimati', 'Pacific/Niue']
check('starts at the earliest today across zones',
  resolveWindow({}, spread).start, todayInZone('Pacific/Niue'))
check('a single zone uses its own today',
  resolveWindow({}, ['Pacific/Kiritimati']).start, todayInZone('Pacific/Kiritimati'))
check('no zones at all still resolves', /^\d{4}-\d{2}-\d{2}$/.test(resolveWindow({}, []).start), true)


// ---------------------------------------------------------------------------
// Booking request wording. Dan: the ask has to say "7/28 through 8/4, first day
// travel, last day travel and work" — a bare range cannot distinguish a travel
// day from a full day on site, and that is what a crew member needs in order to
// answer without ringing somebody.
// ---------------------------------------------------------------------------
const day = (date: string, kind: 'work' | 'travel' | 'in' | 'out' = 'work') => ({
  date,
  isTravelDay: kind === 'travel',
  travelIn: kind === 'in',
  travelOut: kind === 'out',
})
const run = (kinds: ('work' | 'travel' | 'in' | 'out')[], start = 28) =>
  kinds.map((k, i) => day(addDays(`2026-07-${start}`, i), k))

console.log('\ndescribeDates — travel')
check('a plain run says only the range',
  describeDates(run(['work', 'work', 'work'])), 'Tue, Jul 28 – Thu, Jul 30 (3 days)')
check("Dan's case: travel in, travel-and-work out",
  describeDates(run(['travel', 'work', 'work', 'work', 'work', 'work', 'work', 'out'])),
  'Tue, Jul 28 – Tue, Aug 4 (8 days) · first day travel, last day travel and work')
check('travel both ends collapses to one phrase',
  describeDates(run(['travel', 'work', 'travel'])),
  'Tue, Jul 28 – Thu, Jul 30 (3 days) · first and last days travel')
check('travel in only',
  describeDates(run(['travel', 'work', 'work'])),
  'Tue, Jul 28 – Thu, Jul 30 (3 days) · first day travel')
check('travel out only',
  describeDates(run(['work', 'work', 'travel'])),
  'Tue, Jul 28 – Thu, Jul 30 (3 days) · last day travel')
check('travel-and-work both ends does not collapse into "travel"',
  describeDates(run(['in', 'work', 'out'])),
  'Tue, Jul 28 – Thu, Jul 30 (3 days) · first and last days travel and work')
check('a mid-run travel day is named explicitly',
  describeDates(run(['work', 'travel', 'work'])),
  'Tue, Jul 28 – Thu, Jul 30 (3 days) · Wed, Jul 29 travel')
check('a single travel day says travel only',
  describeDates([day('2026-07-28', 'travel')]), 'Tue, Jul 28 · travel only')
check('a single work day is just the date',
  describeDates([day('2026-07-28')]), 'Tue, Jul 28')
check('no days at all does not render an empty range',
  describeDates([]), 'dates to be confirmed')
// Non-contiguous: the partial-show case Dan flagged as coming later. It must
// already read correctly rather than implying days nobody is booked for.
check('non-contiguous days are listed, never collapsed into a range',
  describeDates([day('2026-07-28'), day('2026-07-31', 'travel')]),
  'Tue, Jul 28, Fri, Jul 31 · last day travel')
// Order is not guaranteed by the query; the description must not depend on it.
check('unsorted input still reads in order',
  describeDates([day('2026-07-30'), day('2026-07-28', 'travel'), day('2026-07-29')]),
  'Tue, Jul 28 – Thu, Jul 30 (3 days) · first day travel')

console.log('\nbuildBookingRequestText')
const sms = buildBookingRequestText({
  crewName: 'Alex Reyes', showName: 'Beacon Field Summit', venue: 'Moscone West',
  cityState: null, organizationName: 'Northwind Staging Co.', role: 'A1',
  days: run(['travel', 'work', 'out']),
})
// A company name ending in a period must not produce "Co..".
check('no doubled period after a company name', /Co\.\./.test(sms), false)
check('the travel note is its own sentence', sms.includes('First day travel, last day travel and work.'), true)
check('venue sits with the question, not after the dates', sms.includes('as A1 at Moscone West?'), true)
// The texted version must never carry a link — an action-link by SMS is
// indistinguishable from phishing, and Dan asked for no action links.
check('no link in the text message', /https?:\/\//.test(sms), false)
check('no money in the text message', /\$/.test(sms), false)

// ---------------------------------------------------------------------------
// Show status. Dan asked for New and Staffing alongside the existing states, so
// a created show and a fully-crewed one stop looking identical. The precedence
// is the subtle part: dates win once a show has reached them.
// ---------------------------------------------------------------------------
console.log('\nshowStatus')
const future = { start_date: '2026-12-01', end_date: '2026-12-05' }
const today = '2026-07-28'
const st = (over: Record<string, unknown>) => showStatus({ ...future, ...over } as any, today)

check('a show with no call yet is New', st({ positionsTotal: 0, positionsFilled: 0 }), 'new')
check('a part-filled call is Staffing', st({ positionsTotal: 4, positionsFilled: 1 }), 'staffing')
check('an unfilled call is Staffing, not New', st({ positionsTotal: 4, positionsFilled: 0 }), 'staffing')
check('a fully filled call is Pre-show', st({ positionsTotal: 4, positionsFilled: 4 }), 'preshow')
// Shows created before the crew call existed carry no counts at all and must
// not all collapse to one state by accident.
check('missing counts read as New rather than crashing', st({}), 'new')

// Dates outrank crewing once reached: a show on site today is Active whether or
// not its paperwork was ever finished.
check('a running show is Active even with an empty call',
  showStatus({ start_date: '2026-07-27', end_date: '2026-07-29', positionsTotal: 0, positionsFilled: 0 } as any, today), 'active')
check('a running show is Active even when short-staffed',
  showStatus({ start_date: '2026-07-27', end_date: '2026-07-29', positionsTotal: 6, positionsFilled: 2 } as any, today), 'active')
check('a past show is Wrapped, not Staffing',
  showStatus({ start_date: '2026-07-01', end_date: '2026-07-05', positionsTotal: 6, positionsFilled: 0 } as any, today), 'wrapped')
check('the first day counts as Active',
  showStatus({ start_date: today, end_date: '2026-07-30' } as any, today), 'active')
check('the last day counts as Active',
  showStatus({ start_date: '2026-07-26', end_date: today } as any, today), 'active')

// Archiving and finalizing are filing decisions and outrank everything.
check('archived beats every other state',
  st({ archived: true, positionsTotal: 0 }), 'archived')
check('finalized beats crewing state',
  st({ finalized_at: '2026-07-20T00:00:00Z', positionsTotal: 4, positionsFilled: 0 }), 'finalized')
check('archived beats finalized',
  st({ archived: true, finalized_at: '2026-07-20T00:00:00Z' }), 'archived')

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
