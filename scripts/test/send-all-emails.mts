// Send EVERY email this app can send, to one inbox, for reading in a real
// mail client (Dan, 2026-09-09: "I want to actually see them in my inbox").
//
//   npm run email:all
//
// The previews print plain text; this is the only way to see what the HTML
// actually looks like on a phone, which is where most of them are read.
//
// SAFE BY CONSTRUCTION. It runs against whatever .env.local points at, which
// is DEV — and lib/sendEmail.ts redirects every message on a non-production
// database to DEV_EMAIL_TO, with the intended recipient written into the
// subject: "[dev → alex@example.test] You are booked". The addresses below are
// therefore fictional on purpose; nothing reaches them. It also refuses
// outright if pointed at production, because there the guard does not apply
// and these would be real emails to whatever address is on the row.
//
// Not included, because the app does not send them: the four Supabase Auth
// templates (confirm signup, magic link, password reset, email change) go out
// over Supabase's own SMTP. Trigger those from the live site to see them.

import { isProductionData } from '../../lib/sendEmail.ts'
import { sendInviteEmail } from '../../lib/inviteEmail.ts'
import { sendPmInviteEmail, sendPmDeclinedEmail, describeShowDates } from '../../lib/pmInviteEmail.ts'
import { sendCallHandoffEmail } from '../../lib/callHandoffEmail.ts'
import { sendBookingRequestEmail, sendDeclineNoticeEmail } from '../../lib/bookingEmail.ts'
import { sendReadyEmail, compressDays } from '../../lib/readyEmail.ts'
import { sendDigestEmail, describeEvent } from '../../lib/digestEmail.ts'
import { sendDaysChangedEmail } from '../../lib/daysChangedEmail.ts'
import { buildFinalReportEmail } from '../../lib/finalReportEmail.ts'
import { sendEmail } from '../../lib/sendEmail.ts'

if (isProductionData()) {
  console.error(`
REFUSED. .env.local points at the PRODUCTION database, where the dev redirect
does not apply — every message below would go to the address on the row, and
several of those are real crew. Point .env.local at dev and try again.
`)
  process.exit(1)
}
if (!process.env.DEV_EMAIL_TO) {
  console.error('Set DEV_EMAIL_TO in .env.local — that is the inbox all of this lands in.')
  process.exit(1)
}
if (!process.env.RESEND_API_KEY) {
  console.error('Set RESEND_API_KEY in .env.local.')
  process.exit(1)
}

const ORG = 'Wood & Waves Productions'
const SHOW = 'Northwind User Conference'
const LINK = 'https://crewtracker.app/dashboard/shows/00000000-0000-0000-0000-000000000000'
const days = [
  { date: '2026-10-01', isTravelDay: false, travelIn: true, travelOut: false, activities: ['travel', 'load_in'] },
  { date: '2026-10-02', isTravelDay: false, travelIn: false, travelOut: false, activities: ['load_in'] },
  { date: '2026-10-03', isTravelDay: false, travelIn: false, travelOut: false, activities: ['rehearsal'] },
  { date: '2026-10-04', isTravelDay: false, travelIn: false, travelOut: false, activities: ['show'] },
  { date: '2026-10-05', isTravelDay: false, travelIn: false, travelOut: true, activities: ['show', 'load_out', 'travel'] },
]

/** Every message, in the order a show actually produces them. */
const EMAILS: { name: string; send: () => Promise<{ error?: string }> }[] = [
  {
    name: '1. Team invite — a new person joins the company',
    send: () => sendInviteEmail({
      to: 'newteammate@example.test', organizationName: ORG, inviterName: 'Dan Smith',
      inviterOrganizationName: ORG, role: 'pm',
      link: 'https://crewtracker.app/invite/11111111-1111-1111-1111-111111111111',
      expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    }),
  },
  {
    name: '2. PM invitation — will you run this show?',
    send: () => sendPmInviteEmail({
      to: 'pm@example.test', pmName: 'Sam Okafor', showName: SHOW,
      dates: describeShowDates('2026-10-01', '2026-10-05'), venue: 'Moscone West', orgName: ORG,
      days: days.map(d => ({ date: d.date, activities: d.activities })),
      acceptUrl: 'https://crewtracker.app/pm/22222222-2222-2222-2222-222222222222?accept=1',
      declineUrl: 'https://crewtracker.app/pm/22222222-2222-2222-2222-222222222222?decline=1',
    }),
  },
  {
    name: '3. The PM said no — back to whoever invited them',
    send: () => sendPmDeclinedEmail({
      to: 'dan@example.test', inviterName: 'Dan Smith', pmName: 'Sam Okafor', showName: SHOW,
      orgName: ORG, note: "I'm on the Kestrel load-out that week.", link: LINK,
    }),
  },
  {
    name: '4. Ready for staffing — to everyone who can schedule',
    send: () => sendCallHandoffEmail({
      to: 'scheduler@example.test', recipientName: 'Sasha Vine', showName: SHOW, venue: 'Moscone West',
      startDate: '2026-10-01', endDate: '2026-10-05', organizationName: ORG, sentByName: 'Dan Smith',
      callSize: 'up to 6 crew across 5 days', link: LINK,
    }),
  },
  {
    name: '5. Booking request — are you available?',
    send: () => sendBookingRequestEmail({
      to: 'alex@example.test', crewName: 'Alex Reyes', showName: SHOW, venue: 'Moscone West',
      cityState: 'San Francisco, CA', organizationName: ORG, role: 'A1', days,
      link: 'https://crewtracker.app/book/33333333-3333-3333-3333-333333333333',
      confirmUrl: 'https://crewtracker.app/book/33333333-3333-3333-3333-333333333333?a=confirm',
      declineUrl: 'https://crewtracker.app/book/33333333-3333-3333-3333-333333333333?a=decline',
    }),
  },
  {
    name: '6. Crew said no — to everyone who can schedule',
    send: () => sendDeclineNoticeEmail({
      to: 'scheduler@example.test', recipientName: 'Sasha Vine', crewName: 'Alex Reyes',
      showName: SHOW, note: "I'm out of town that week.", link: LINK,
    }),
  },
  {
    name: '7. Days changed — the revised schedule, with Accept and Decline',
    send: () => sendDaysChangedEmail({
      to: 'alex@example.test', crewName: 'Alex Reyes', showName: SHOW, orgName: ORG,
      venue: 'Moscone West', days,
      confirmUrl: 'https://crewtracker.app/book/44444444-4444-4444-4444-444444444444?a=confirm',
      declineUrl: 'https://crewtracker.app/book/44444444-4444-4444-4444-444444444444?a=decline',
    }),
  },
  {
    name: '8. Off the show — please release your dates',
    send: () => sendDaysChangedEmail({
      to: 'jordan@example.test', crewName: 'Jordan Vega', showName: SHOW, orgName: ORG,
      venue: 'Moscone West', days: [], removed: true, heldDates: 'Thu, Oct 1 – Mon, Oct 5',
    }),
  },
  {
    name: '9. Fully staffed — to the PM, by room',
    send: () => sendReadyEmail({
      to: 'pm@example.test', pmName: 'Sam Okafor', showName: SHOW,
      dates: describeShowDates('2026-10-01', '2026-10-05'), venue: 'Moscone West', orgName: ORG,
      link: LINK,
      rooms: [
        { name: 'Ballroom A', people: [
          { name: 'Alex Reyes', role: 'A1', days: compressDays(['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05']) },
          { name: 'Dana Okafor', role: 'Stagehand', days: compressDays(['2026-10-02','2026-10-05']) },
        ] },
        { name: 'Salon C', people: [
          { name: 'Priya Nair', role: 'A2', days: compressDays(['2026-10-03','2026-10-04','2026-10-05']) },
        ] },
      ],
    }),
  },
  {
    name: "10. Evening digest — the day's crew changes, to the PM",
    send: () => sendDigestEmail({
      to: 'pm@example.test', pmName: 'Sam Okafor', showName: SHOW, date: 'Oct 1', link: LINK,
      lines: [
        { time: '9:02 am', text: describeEvent({ kind: 'booked', crewMemberName: 'Alex Reyes', role: 'A1', days: 'Thu 1 – Mon 5' }) },
        { time: '11:47 am', text: describeEvent({ kind: 'declined', crewMemberName: 'Bo Ellery', role: 'Stagehand', days: null }) },
        { time: '1:15 pm', text: describeEvent({ kind: 'moved', crewMemberName: 'Casey Nguyen', role: 'A2', days: 'Sat 3' }) },
        { time: '4:30 pm', text: describeEvent({ kind: 'released', crewMemberName: 'Jordan Vega', role: 'Stagehand', days: null }) },
      ],
    }),
  },
  {
    name: '11. Final Payroll Report — to the recipients on Settings (no attachments here)',
    send: async () => {
      const mail = buildFinalReportEmail({
        showName: SHOW, clientCompany: 'Northwind Logistics', jobNumber: 'CT-2601',
        cityState: 'San Francisco, CA', dates: describeShowDates('2026-10-01', '2026-10-05'),
        finalizedNote: 'Final report · times locked Oct 6, 2026 by Dan Smith',
      })
      return sendEmail({
        from: 'CrewTracker <noreply@contact.crewtracker.app>',
        to: 'payroll@example.test', subject: mail.subject, text: mail.text, html: mail.html,
      })
    },
  },
]

// `npm run email:all -- 5 7` sends only those, for when one has been reworded
// and the other ten do not need saying again.
const wanted = process.argv.slice(2).map(Number).filter(n => Number.isInteger(n) && n > 0)
const chosen = wanted.length
  ? EMAILS.filter((_, i) => wanted.includes(i + 1))
  : EMAILS

console.log(`\nSending ${chosen.length} of ${EMAILS.length} emails. Every one lands in ${process.env.DEV_EMAIL_TO}.\n`)
let sent = 0
for (const e of chosen) {
  const { error } = await e.send()
  if (error) console.log(`  ✗ ${e.name}\n      ${error}`)
  else { console.log(`  ✓ ${e.name}`); sent++ }
  // Resend's default allowance is two a second; one at a time, unhurried.
  await new Promise(r => setTimeout(r, 600))
}
console.log(`\n${sent} of ${chosen.length} sent to ${process.env.DEV_EMAIL_TO}.`)
console.log('Subjects read "[dev → whoever] …" — that prefix is the guard, not part of the email.\n')
