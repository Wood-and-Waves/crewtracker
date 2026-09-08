import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitOr, clientIp } from '@/lib/rateLimit'
import { declinePmInvite } from '@/lib/pmInvite'

// The production manager saying no — and, if they want, saying why.
//
// The show goes straight back to having no PM: the pointer, the stamps, the
// invitation and any access an acceptance granted are all removed. Whoever
// named them is emailed, with their note carried through whole.
//
// No login required — the token is the authorization, so this runs with the
// service role, exactly like /api/pm/accept. POST only, and allowlisted in
// proxy.ts alongside it.

export async function POST(request: Request) {
  let token: string | undefined
  let note: string | undefined
  try {
    ({ token, note } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!token || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  // A note is a message to a colleague, not an essay; long enough for "I'm on
  // another show that week", capped so nothing unbounded reaches an inbox.
  const trimmed = typeof note === 'string' ? note.trim().slice(0, 600) : ''

  const admin = createAdminClient()
  const stop = await rateLimitOr(admin, [
    { key: `pm-decline:${token}`, limit: 10, windowSeconds: 3600 },
    { key: `pm-decline-ip:${clientIp(request)}`, limit: 30, windowSeconds: 3600 },
  ])
  if (stop) return stop

  const result = await declinePmInvite(token, trimmed || null)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, showName: result.showName, told: !!result.told })
}
