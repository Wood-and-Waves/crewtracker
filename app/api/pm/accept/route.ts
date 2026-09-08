import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitOr, clientIp } from '@/lib/rateLimit'
import { acceptPmInvite } from '@/lib/pmInvite'

// The production manager accepting a show. THIS is the only thing that grants
// them access: it writes the show_assignments row (source='pm') that the shows
// policy reads. Naming them wrote a pointer and a token, nothing more.
//
// No login required — the token is the authorization, so this runs with the
// service role. POST ONLY: mail scanners prefetch links, and a GET that
// accepted would be accepted by Outlook before the person read the email.
// Allowlisted in proxy.ts with /pm.

export async function POST(request: Request) {
  let token: string | undefined
  try {
    ({ token } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!token || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const stop = await rateLimitOr(admin, [
    { key: `pm-accept:${token}`, limit: 10, windowSeconds: 3600 },
    { key: `pm-accept-ip:${clientIp(request)}`, limit: 30, windowSeconds: 3600 },
  ])
  if (stop) return stop

  const result = await acceptPmInvite(token)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, showId: result.showId })
}
