// Prints the booking request as a crew member actually receives it — email
// text and the SMS paste — so the wording and, especially, the LENGTH can be
// judged by reading rather than guessed at.
//
//   npm run preview:booking
//
// Renders nothing and sends nothing. Pure formatting, no database, no Resend.

import { buildBookingRequestEmail, buildBookingRequestText, type EngagementDay } from '../../lib/bookingEmail.ts'

function day(
  date: string,
  dayType: string | null,
  kind: 'work' | 'travel' | 'in' | 'out' = 'work',
): EngagementDay {
  return {
    date,
    isTravelDay: kind === 'travel',
    travelIn: kind === 'in',
    travelOut: kind === 'out',
    dayType,
  }
}

// A realistic five-day corporate run: travel in and load, load, rehearse, show,
// then show and load out with travel home the same day.
const fiveDay = [
  day('2026-09-10', 'travel_load_in', 'in'),
  day('2026-09-11', 'load_in'),
  day('2026-09-12', 'rehearsal'),
  day('2026-09-13', 'show'),
  day('2026-09-14', 'show_load_out', 'out'),
]

// The case worth staring at: a long run makes a long text message.
const tenDay = [
  day('2026-09-10', 'travel_load_in', 'in'),
  day('2026-09-11', 'load_in'),
  day('2026-09-12', 'load_in'),
  day('2026-09-13', 'rehearsal'),
  day('2026-09-14', 'rehearsal'),
  day('2026-09-15', 'show'),
  day('2026-09-16', 'show'),
  day('2026-09-17', 'show'),
  day('2026-09-18', 'show_load_out'),
  day('2026-09-19', 'load_out_travel', 'out'),
]

const base = {
  crewName: 'Alex Reyes',
  showName: 'Northwind User Conference',
  venue: 'Moscone West',
  cityState: 'San Francisco, CA',
  organizationName: 'Wood & Waves Productions',
  role: 'A1',
}

function show(title: string, days: EngagementDay[]) {
  const { subject, text } = buildBookingRequestEmail({ ...base, days, to: 'a@b.test', link: 'https://crewtracker.app/book/abc123' })
  const sms = buildBookingRequestText({ ...base, days })
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`)
  console.log(`\n--- EMAIL --- subject: ${subject}\n`)
  console.log(text)
  console.log(`\n--- SMS --- ${sms.length} characters (${Math.ceil(sms.length / 160)} message${sms.length > 160 ? 's' : ''})\n`)
  console.log(sms)
}

show('FIVE-DAY RUN', fiveDay)
show('TEN-DAY RUN — the length case', tenDay)
show('NO DAY TYPES SET — must look exactly as it did before', [
  day('2026-09-10', null, 'travel'),
  day('2026-09-11', null),
  day('2026-09-12', null, 'out'),
])
console.log('')
