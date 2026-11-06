// Show import tests — pure, no database.
//
//   npm run test:import
//
// The planner is tested against hand-written CSVs rather than against the
// template alone, because the template is the file Dan WRITES; the files he
// IMPORTS have been through Excel, which rewrites dates as M/D/YYYY, pads
// short rows with commas and quotes any cell holding a comma.

import { parseCsv, csvLine } from '../../lib/csv.ts'
import {
  parseShowImport, buildTemplateCsv, parseDateCell, parseActivitiesCell, parseDayCell, parseTimezone,
  type ImportContext,
} from '../../lib/showImport.ts'

let pass = 0, fail = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  a === e ? (pass++, console.log(`  ✓ ${name}`))
          : (fail++, console.log(`  ✗ ${name}\n      expected ${e}, got ${a}`))
}

const ctx: ImportContext = {
  presetNames: ['Standard', 'Union'],
  knownRoles: ['A1', 'Stagehand'],
  knownCrewNames: ['Alex Reyes', 'nina brennan'],
  canManageCrew: true,
  canEditRates: true,
}

console.log('\nparseCsv')
check('plain rows', parseCsv('a,b\nc,d\n').map(r => r.cells), [['a', 'b'], ['c', 'd']])
check('a quoted comma stays in the cell', parseCsv('City,"Dallas, TX"').map(r => r.cells), [['City', 'Dallas, TX']])
check('"" inside quotes is one quote', parseCsv('"say ""hi"""').map(r => r.cells), [['say "hi"']])
check('a line break inside quotes stays in the cell', parseCsv('"two\nlines",x\ny').map(r => r.cells), [['two\nlines', 'x'], ['y']])
check('a quoted line break does not shift later line numbers', parseCsv('"two\nlines",x\ny').map(r => r.line), [1, 3])
check('CRLF and a BOM are invisible', parseCsv('﻿a,b\r\nc,d\r\n').map(r => r.cells), [['a', 'b'], ['c', 'd']])
check('trailing empty cells survive (Excel padding)', parseCsv('a,,\n').map(r => r.cells), [['a', '', '']])
check('csvLine quotes everything and escapes quotes', csvLine(['a', 'b "c"', 1]), '"a","b ""c""","1"')

console.log('\nparseDateCell')
check('ISO', parseDateCell('2026-11-10'), '2026-11-10')
check('Excel M/D/YYYY', parseDateCell('11/10/2026'), '2026-11-10')
check('Excel M/D/YY', parseDateCell('1/5/26'), '2026-01-05')
check('not a date', parseDateCell('Monday'), null)
check('Feb 30 is not a date', parseDateCell('2026-02-30'), null)

console.log('\nparseActivitiesCell')
check('plus-joined words, chronological', parseActivitiesCell('Load-in + Travel').activities, ['travel', 'load_in'])
check('travel reads last on a load-out day', parseActivitiesCell('travel/show/load out').activities, ['show', 'load_out', 'travel'])
check('strike means load-out', parseActivitiesCell('Strike').activities, ['load_out'])
check('an unknown word is named', parseActivitiesCell('Show + Party').unknown, ['Party'])
check('blank is nothing', parseActivitiesCell('').activities, [])

console.log('\nparseDayCell')
check('W works', parseDayCell('w'), 'work')
check('X works', parseDayCell('X'), 'work')
check('T travels', parseDayCell('T'), 'travel')
check('TI travels in', parseDayCell('ti'), 'travel_in')
check('TO travels out', parseDayCell('TO'), 'travel_out')
check('blank is off', parseDayCell('  '), null)
check('nonsense is bad', parseDayCell('maybe'), 'bad')

console.log('\nparseTimezone')
check('blank is Central', parseTimezone(''), 'America/Chicago')
check('a word', parseTimezone('Pacific'), 'America/Los_Angeles')
check('an abbreviation', parseTimezone('ET'), 'America/New_York')
check('"Central Time"', parseTimezone('Central Time'), 'America/Chicago')
check('the IANA name', parseTimezone('America/Denver'), 'America/Denver')
check('unknown', parseTimezone('Lunar'), null)

console.log('\nthe template round-trips')
const tpl = buildTemplateCsv('2026-11-10')
const t = parseShowImport(tpl, ctx)
check('no errors', t.errors, [])
check('no warnings', t.warnings, [])
check('the key at the foot of the template is ignored, not read as crew', t.plan?.crew.length, 3)
check('the template carries the key', tpl.includes('# Crew cells: W works'), true)
check('show details', t.plan?.show, {
  name: 'Example Sales Kickoff', venue: 'Hilton Anatole', cityState: 'Dallas, TX', clientCompany: 'Example Client',
  jobNumber: '2611-04', notes: 'Dock B for load-in', timezone: 'America/Chicago', confirmed: true, financials: true,
  contactName: 'Ray Delgado', contactPhone: '(214) 555-0148', presetName: null,
})
check('four days with their activities', t.plan?.days, [
  { date: '2026-11-10', activities: ['travel', 'load_in'] },
  { date: '2026-11-11', activities: ['rehearsal'] },
  { date: '2026-11-12', activities: ['show'] },
  { date: '2026-11-13', activities: ['show', 'load_out', 'travel'] },
])
check('rooms in order of first appearance', t.plan?.rooms, ['Ballroom', 'Breakout A'])
check('three crew, ten timecards', [t.plan?.crew.length, t.plan?.timecardCount], [3, 10])
check("Alex's days carry the legs", t.plan?.crew[0].days, [
  { date: '2026-11-10', kind: 'travel' }, { date: '2026-11-11', kind: 'work' },
  { date: '2026-11-12', kind: 'work' }, { date: '2026-11-13', kind: 'travel_out' },
])
check('Theo is new to the directory, Alex is not', t.plan?.crew.map(c => c.isNew), [false, false, true])
check('new people and roles are listed', [t.plan?.newCrew, t.plan?.newRoles], [['Theo Lindqvist'], ['Camera Operator']])
check('a phone is formatted', t.plan?.crew[0].phone, '(214) 555-0101')

console.log('\nExcel re-save: M/D/YYYY dates, padded rows, quoted city')
const excel = [
  'Show,Padded Show,,,,,,,',
  'City,"Dallas, TX",,,,,,,',
  ',,,,,,,,',
  'Name,Role,Room,Day Rate,Phone,Email,11/10/2026,11/11/2026',
  'Day,,,,,,Load-in,Show',
  'Alex Reyes,A1,,"$1,200",,,W,W',
].join('\r\n')
const x = parseShowImport(excel, ctx)
check('no errors', x.errors, [])
check('dates normalised', x.plan?.days.map(d => d.date), ['2026-11-10', '2026-11-11'])
check('city kept its comma', x.plan?.show.cityState, 'Dallas, TX')
check('blank room is Main Stage', x.plan?.rooms, ['Main Stage'])
check('a dollar rate with a thousands comma', x.plan?.crew[0].dayRate, 1200)
check('timezone defaults to Central', x.plan?.show.timezone, 'America/Chicago')

console.log('\nerrors name the row')
const bad = (rows: string[]) => parseShowImport(rows.join('\n'), ctx)
check('a date gap', bad(['Show,S', 'Name,Role,Room,2026-11-10,2026-11-12', 'A,A1,R,W,W']).errors.map(e => [e.row, e.message]),
  [[2, 'Dates must be every day from first to last; 2026-11-11 is missing between 2026-11-10 and 2026-11-12.']])
check('a bad activity word', bad(['Show,S', 'Name,Role,Room,2026-11-10', 'Day,,,Lunch', 'A,A1,R,W']).errors.map(e => e.row), [3])
check('a bad day cell', bad(['Show,S', 'Name,Role,Room,2026-11-10', 'A,A1,R,maybe']).errors[0].message,
  '"maybe" under 2026-11-10 for A is not W, T, TI or TO.')
check('a missing name', bad(['Show,S', 'Name,Role,Room,2026-11-10', ',A1,R,W']).errors[0].message, 'A crew row has no name.')
check('a missing role', bad(['Show,S', 'Name,Role,Room,2026-11-10', 'A,,R,W']).errors[0].message, 'A has no role.')
check('no show name', bad(['Venue,V', 'Name,Role,Room,2026-11-10', 'A,A1,R,W']).errors[0].message,
  'The show needs a name: a row reading Show,<name> above the roster.')
check('an unknown detail key', bad(['Show,S', 'Colour,Blue', 'Name,Role,Room,2026-11-10', 'A,A1,R,W']).errors.map(e => e.row), [2])
check('an unknown preset', bad(['Show,S', 'Payroll Preset,Gold', 'Name,Role,Room,2026-11-10', 'A,A1,R,W']).errors[0].message,
  'No payroll preset called "Gold". Leave it blank for the default.')
check('a known preset, any case', bad(['Show,S', 'Preset,union', 'Name,Role,Room,2026-11-10', 'A,A1,R,W']).plan?.show.presetName, 'Union')
check('same person twice in one room on one day', bad(['Show,S', 'Name,Role,Room,2026-11-10', 'A,A1,R,W', 'A,A2,R,W']).errors[0].message,
  'A is already in R on 2026-11-10 (row 3). One person is in a room once a day.')
check('no roster at all', bad(['Show,S']).errors[0].message, 'No roster found. The crew table starts with a header row holding Name, Role, Room and the dates.')
check('nothing is planned while there are errors', bad(['Show,S', 'Name,Role,Room,2026-11-10', 'A,A1,R,maybe']).plan, null)

console.log('\nwarnings')
check('a rate that disagrees: first wins', bad(['Show,S', 'Name,Role,Room,Day Rate,2026-11-10', 'A,A1,R,100,W', 'A,A1,Other,200,W']).warnings[0].message,
  'A as A1 is $200 here and $100 on row 3. A rate is show-wide, so $100 is used on every day.')
check('a person with no days is left off', bad(['Show,S', 'Name,Role,Room,2026-11-10', 'A,A1,R,', 'B,A1,R,W']).warnings[0].message,
  'A has no day marked, so they are not put on the show.')
check('…and is not in the plan', bad(['Show,S', 'Name,Role,Room,2026-11-10', 'A,A1,R,', 'B,A1,R,W']).plan?.crew.map(c => c.name), ['B'])

console.log('\npermissions')
const noCrew = { ...ctx, canManageCrew: false }
check('an unknown name without the directory permission is an error',
  parseShowImport('Show,S\nName,Role,Room,2026-11-10\nZed,A1,R,W', noCrew).errors[0].message,
  'Zed is not in the directory, and your account cannot add people to it.')
check('a known name without it is fine', parseShowImport('Show,S\nName,Role,Room,2026-11-10\nAlex Reyes,A1,R,W', noCrew).errors, [])
const noRates = { ...ctx, canEditRates: false }
check('rates without the pay-rate permission warn', parseShowImport('Show,S\nName,Role,Room,Rate,2026-11-10\nAlex Reyes,A1,R,500,W', noRates).warnings[0].message,
  'Your account cannot set pay rates, so every day rate in the file lands as 0.')

console.log('\n# notes')
check('a # row anywhere is skipped', bad(['# my notes', 'Show,S', '# more', 'Name,Role,Room,2026-11-10', '# between', 'A,A1,R,W', '#last']).plan?.crew.map(c => c.name), ['A'])
check('a # row is skipped even with leading spaces', bad(['Show,S', 'Name,Role,Room,2026-11-10', '  # note', 'A,A1,R,W']).errors, [])

console.log('\nrooms')
check('rooms are matched case-insensitively, first spelling kept',
  bad(['Show,S', 'Name,Role,Room,2026-11-10', 'A,A1,Ballroom,W', 'B,A1,BALLROOM,W']).plan?.rooms, ['Ballroom'])
check('header columns may come in any order',
  bad(['Show,S', 'Room,Name,Role,2026-11-10', 'R,A,A1,W']).plan?.crew[0],
  { row: 3, name: 'A', role: 'A1', room: 'R', dayRate: 0, phone: '', email: '', isNew: true, days: [{ date: '2026-11-10', kind: 'work' }] })

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
