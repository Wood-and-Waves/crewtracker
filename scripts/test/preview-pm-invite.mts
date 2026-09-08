// Prints the PM invitation as the person actually receives it, so the wording
// is read rather than guessed at.
//
//   npm run preview:pm
//
// Renders nothing and sends nothing. Pure formatting, no database, no Resend.

import { buildPmInviteEmail, describeShowDates } from '../../lib/pmInviteEmail.ts'

const { subject, text } = buildPmInviteEmail({
  to: 'sam@example.test',
  pmName: 'Sam Okafor',
  showName: 'Northwind User Conference',
  dates: describeShowDates('2026-09-04', '2026-09-09'),
  venue: 'Moscone West',
  orgName: 'Wood & Waves Productions',
  inviterName: 'Dan Smith',
  acceptUrl: 'https://crewtracker.app/pm/abc123?accept=1',
  declineUrl: 'https://crewtracker.app/pm/abc123?decline=1',
})

console.log(`Subject: ${subject}\n`)
console.log(text)
console.log('\n---')
console.log('dates:', describeShowDates('2026-09-04', '2026-09-09'), '|', describeShowDates('2026-09-28', '2026-10-03'), '|', describeShowDates('2026-09-04', '2026-09-04'))
