import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitOr, clientIp } from '@/lib/rateLimit'
import { maybeSendReadyEmail, isExpectedReadyReason } from '@/lib/showReadiness'

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

  const { data: invite } = await admin
    .from('pm_invites')
    .select('id, show_id, profile_id, organization_id, accepted_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  if (invite.accepted_at) return NextResponse.json({ ok: true, showId: invite.show_id })

  // Still the named PM? Naming somebody else deletes the old invites, but a
  // race is cheap to close here too.
  const { data: show } = await admin.from('shows').select('id, pm_profile_id').eq('id', invite.show_id).maybeSingle()
  if (!show || show.pm_profile_id !== invite.profile_id) {
    return NextResponse.json({ error: 'This invitation has been replaced. Check with whoever named you.' }, { status: 410 })
  }
  const { data: member } = await admin
    .from('memberships').select('profile_id')
    .eq('profile_id', invite.profile_id).eq('organization_id', invite.organization_id).is('deactivated_at', null).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Your membership of this company is no longer active.' }, { status: 403 })

  const now = new Date().toISOString()

  // The grant. A hand-granted assignment may already exist; then there is
  // nothing to add and nothing to relabel.
  const { data: existing } = await admin
    .from('show_assignments').select('id').eq('show_id', show.id).eq('profile_id', invite.profile_id).maybeSingle()
  if (!existing) {
    const { error } = await admin
      .from('show_assignments')
      .insert({ show_id: show.id, profile_id: invite.profile_id, source: 'pm' })  // organization_id: its trigger
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    admin.from('pm_invites').update({ accepted_at: now }).eq('id', invite.id),
    admin.from('shows').update({ pm_accepted_at: now }).eq('id', show.id),
  ])
  if (e1 || e2) return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 })

  // The show may already have been fully staffed before the PM accepted —
  // that's the second path into the ready email. Never fails accepting.
  const { sent, reason } = await maybeSendReadyEmail(admin, show.id)
  if (!sent && !isExpectedReadyReason(reason)) {
    console.error('maybeSendReadyEmail failed after a PM accept:', reason)
  }

  return NextResponse.json({ ok: true, showId: show.id })
}
