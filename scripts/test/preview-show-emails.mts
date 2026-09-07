// Prints show-flow emails as the recipient actually receives them, so the
// wording is read rather than guessed at.
//
//   npm run preview:emails
//
// Renders nothing and sends nothing. Pure formatting, no database, no Resend.
// Tasks 4-6 add their emails to this same script.

import { buildCallHandoffEmail } from '../../lib/callHandoffEmail.ts'
import { summarizeCall, describeCallSize } from '../../lib/crewCall.ts'

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
