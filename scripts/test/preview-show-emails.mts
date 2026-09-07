// Prints show-flow emails as the recipient actually receives them, so the
// wording is read rather than guessed at.
//
//   npm run preview:emails
//
// Renders nothing and sends nothing. Pure formatting, no database, no Resend.
// Tasks 4-6 add their emails to this same script.

import { buildCallHandoffEmail } from '../../lib/callHandoffEmail.ts'
import { summarizeCall, describeCallSize } from '../../lib/crewCall.ts'
import { buildReadyEmail, compressDays } from '../../lib/readyEmail.ts'
import { buildDigestEmail, describeEvent } from '../../lib/digestEmail.ts'

console.log('=== Send to scheduling ===\n')

const call = summarizeCall(
  // 14 positions across 6 days, so the peak-per-day math has something to chew on.
  Array.from({ length: 6 }, (_, day) => Array.from({ length: day < 4 ? 2 : 3 }, () => ({
    date: `2026-09-${4 + day}`,
  }))).flat().slice(0, 14),
)

const { subject, text } = buildCallHandoffEmail({
  to: 'sam@example.test',
  recipientName: 'Sam Okafor',
  showName: 'Northwind User Conference',
  venue: 'Moscone West',
  startDate: '2026-09-04',
  endDate: '2026-09-09',
  organizationName: 'Wood & Waves Productions',
  sentByName: 'Dan Smith',
  callSize: describeCallSize(call),
  link: 'https://crewtracker.app/dashboard/shows/abc123',
})

console.log(`Subject: ${subject}\n`)
console.log(text)
console.log('\n---')
console.log('callSize:', describeCallSize(call))

console.log('\n\n=== Ready email (show fully staffed) ===\n')

// 3 days, 2 rooms: Alex works all three days, Casey only load-in/show,
// Jordan skips the show day and comes back for load-out.
const readyDays = [
  {
    date: '2026-09-08', label: 'Load-in',
    rooms: [
      { name: 'Ballroom', people: [
        { name: 'Alex Reyes', role: 'A1', phone: '(312) 555-0100' },
        { name: 'Jordan Blake', role: 'Stagehand', phone: null },
      ] },
      { name: 'Breakout A', people: [
        { name: 'Casey Nguyen', role: 'A2', phone: '(312) 555-0142' },
      ] },
    ],
  },
  {
    date: '2026-09-09', label: 'Show',
    rooms: [
      { name: 'Ballroom', people: [
        { name: 'Alex Reyes', role: 'A1', phone: '(312) 555-0100' },
      ] },
      { name: 'Breakout A', people: [
        { name: 'Casey Nguyen', role: 'A2', phone: '(312) 555-0142' },
      ] },
    ],
  },
  {
    date: '2026-09-10', label: 'Show · Load-out',
    rooms: [
      { name: 'Ballroom', people: [
        { name: 'Alex Reyes', role: 'A1', phone: '(312) 555-0100' },
        { name: 'Jordan Blake', role: 'Stagehand', phone: null },
      ] },
    ],
  },
]

const readyPerPerson = [
  { name: 'Alex Reyes', role: 'A1', days: compressDays(['2026-09-08', '2026-09-09', '2026-09-10']) },
  { name: 'Casey Nguyen', role: 'A2', days: compressDays(['2026-09-08', '2026-09-09']) },
  { name: 'Jordan Blake', role: 'Stagehand', days: compressDays(['2026-09-08', '2026-09-10']) },
]

const ready = buildReadyEmail({
  to: 'sam@example.test', pmName: 'Sam Okafor', showName: 'Northwind User Conference',
  dates: 'Sep 8–10', venue: 'Moscone West', orgName: 'Wood & Waves Productions',
  link: 'https://crewtracker.app/dashboard/shows/abc123',
  days: readyDays, perPerson: readyPerPerson, waiting: 0,
})

console.log(`Subject: ${ready.subject}\n`)
console.log(ready.text)

console.log('\n\n=== Evening digest ===\n')

// One show, a mixed day: a straightforward booking still waiting on a
// reply, a decline that got re-filled by someone else before the digest
// went out (so the LINE still says "declined" but the status reads
// "accepted" — that gap is the whole point of computing status at send
// time), a move, and a release with no day in scope.
const digestEvents = [
  { kind: 'booked' as const, crewMemberName: 'Alex Reyes', role: 'A1', days: compressDays(['2026-09-08', '2026-09-09', '2026-09-10']), status: 'waiting on reply' as const, time: '9:02 am' },
  { kind: 'declined' as const, crewMemberName: 'Bo Ellery', role: 'Stagehand', days: null, status: 'accepted' as const, time: '11:47 am' },
  { kind: 'moved' as const, crewMemberName: 'Casey Nguyen', role: 'A2', days: compressDays(['2026-09-09']), status: 'accepted' as const, time: '1:15 pm' },
  { kind: 'released' as const, crewMemberName: 'Jordan Blake', role: 'Stagehand', days: null, status: 'released' as const, time: '4:30 pm' },
]

const digest = buildDigestEmail({
  to: 'sam@example.test', pmName: 'Sam Okafor', showName: 'Northwind User Conference', date: 'Sep 8',
  link: 'https://crewtracker.app/dashboard/shows/abc123',
  lines: digestEvents.map(e => ({ time: e.time, text: describeEvent(e), status: e.status })),
})

console.log(`Subject: ${digest.subject}\n`)
console.log(digest.text)
