import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitOr, clientIp } from '@/lib/rateLimit'
import { respondToBooking } from '@/lib/bookingResponse'

// A crew member's answer to a booking request. No login: the token is the
// authorization, so this runs with the service role.
//
// POST ONLY, DELIBERATELY. Outlook Safe Links and Gmail both PREFETCH URLs in
// email — a GET that recorded the answer would be auto-confirmed by a scanner
// before the person ever read it. The emailed link opens a page; the page posts.
//
// A decline applies to the WHOLE show. Dan: "A decline is for the entire show.
// They would need to work everything." Every timecard of theirs on that show
// moves to 'declined', which frees each position: the partial unique index on
// timecards excludes declined rows, so the scheduler can put somebody else in
// without deleting the record that this person said no.

export async function POST(request: Request) {
  let token: string | undefined
  let response: string | undefined
  let note: string | undefined
  try {
    ({ token, response, note } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!token || (response !== 'confirmed' && response !== 'declined')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // An answer changes hands a few times at most, and each decline sends an
  // email — this is the throttle that turns a leaked link from an inbox-flood
  // button back into a link.
  const stop = await rateLimitOr(admin, [
    { key: `respond:${token}`, limit: 5, windowSeconds: 3600 },
    { key: `respond-ip:${clientIp(request)}`, limit: 30, windowSeconds: 3600 },
  ])
  if (stop) return stop

  const result = await respondToBooking(token, response, note)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, response: result.response })
}
