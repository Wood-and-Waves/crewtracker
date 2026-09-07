import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PUNCH_ORDER, type PunchType } from '@/lib/punches'
import { applyCrewPunch } from '@/lib/clockPunch'

// A SIGNED-IN crew member recording their own punch (Section 3, 2026-09-06).
// The session is the authorization; the rules are lib/clockPunch.ts, shared
// with the no-login link route so the two can never disagree. Service role for
// the write, as the link route — but only after the caller's OWN RLS session
// has proved they can see the show, and the directory link (0028) has proved
// which timecards are theirs.
//
// No rate limit: this route sits behind a login, which the public routes do not.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  let body: { showId?: string; timecardId?: string; punchType?: string; at?: string; clear?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const { showId, timecardId, punchType, at, clear } = body
  if (!showId || !timecardId || !UUID.test(showId) || !UUID.test(timecardId)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!punchType || !(PUNCH_ORDER as readonly string[]).includes(punchType)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
    return NextResponse.json({ error: 'Invalid time.' }, { status: 400 })
  }

  // The caller's OWN session: can they see this show at all?
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  const { data: visible } = await supabase
    .from('shows').select('id, organization_id').eq('id', showId).maybeSingle()
  if (!visible) return NextResponse.json({ error: 'This show is not available.' }, { status: 404 })

  // Their directory entry in that company — the link 0028 made.
  const admin = createAdminClient()
  const { data: crew } = await admin
    .from('crew_members').select('id')
    .eq('organization_id', visible.organization_id).eq('profile_id', user.id).maybeSingle()
  if (!crew) return NextResponse.json({ error: "You aren't staffed on this show." }, { status: 403 })

  const result = await applyCrewPunch(admin, {
    timecardId, type: punchType as PunchType, at, clear: !!clear,
    crewMemberId: crew.id, showId, sourceLink: null, createdBy: user.id,
  })
  return NextResponse.json(result.body, { status: result.status })
}
