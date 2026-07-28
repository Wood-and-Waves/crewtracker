import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBookingRequestEmail, buildBookingRequestText } from '@/lib/bookingEmail'

// Ask a crew member to confirm a booking.
//
// AUTHORIZATION IS THE RLS POLICY. The show and the crew member are read
// through the CALLER'S session, so if either comes back they are entitled to
// it. The service role is used only to write the invite row and mint the token,
// after that check has passed.
//
// Always returns the SMS text as well as sending the email. A scheduler often
// knows a person answers texts and not email, and the two are not alternatives
// — the same ask goes out however they choose. The texted version deliberately
// carries no link (see lib/bookingEmail.ts).

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let showId: string | undefined
  let crewMemberId: string | undefined
  try {
    ({ showId, crewMemberId } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!showId || !crewMemberId) {
    return NextResponse.json({ error: 'Missing showId or crewMemberId.' }, { status: 400 })
  }

  const [{ data: show }, { data: crew }] = await Promise.all([
    supabase
      .from('shows')
      .select('id, name, venue, city_state, end_date, organization_id, finalized_at')
      .eq('id', showId)
      .maybeSingle(),
    supabase.from('crew_members').select('id, full_name, email').eq('id', crewMemberId).maybeSingle(),
  ])

  if (!show || !crew) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (show.finalized_at) {
    return NextResponse.json({ error: 'This show has been closed out.' }, { status: 400 })
  }

  // Their days and role on this show, read as the caller. day_rate is not
  // selected: the request tells them nothing about money.
  const { data: timecards } = await supabase
    .from('timecards')
    .select('id, role, rooms!inner ( work_days!inner ( date, show_id ) )')
    .eq('crew_member_id', crewMemberId)
    .eq('rooms.work_days.show_id', showId)

  const dates = new Set<string>()
  let role: string | null = null
  for (const t of (timecards ?? []) as any[]) {
    const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    if (wd?.date) dates.add(wd.date)
    if (!role && t.role) role = t.role
  }
  if (dates.size === 0) {
    return NextResponse.json(
      { error: 'Book them onto a day before asking them to confirm.' },
      { status: 400 },
    )
  }

  const { data: org } = await supabase
    .from('organizations').select('name').eq('id', show.organization_id).maybeSingle()

  // Expiry: 30 days, but never past the show itself — a link that still works
  // after the show has happened is only a way to confuse somebody.
  const thirtyDays = new Date(Date.now() + 30 * 86_400_000)
  const dayAfterShow = new Date(show.end_date + 'T00:00:00')
  dayAfterShow.setDate(dayAfterShow.getDate() + 1)
  const expiresAt = new Date(Math.min(thirtyDays.getTime(), dayAfterShow.getTime())).toISOString()

  // Upsert on (show_id, crew_member_id) with a FRESH token: re-asking rotates
  // the link so the previous one stops working, and clears any earlier answer
  // because this is a new question.
  const admin = createAdminClient()
  const { data: invite, error: inviteError } = await admin
    .from('booking_invites')
    .upsert({
      show_id: showId,
      crew_member_id: crewMemberId,
      email: crew.email ?? null,
      sent_by: user.id,
      sent_at: new Date().toISOString(),
      expires_at: expiresAt,
      token: crypto.randomUUID(),
      responded_at: null,
      response: null,
      note: null,
    }, { onConflict: 'show_id,crew_member_id' })
    .select('token')
    .single()

  if (inviteError || !invite) {
    return NextResponse.json({ error: inviteError?.message ?? 'Could not create the request.' }, { status: 500 })
  }

  const origin = new URL(request.url).origin
  const link = `${origin}/book/${invite.token}`
  const common = {
    crewName: crew.full_name,
    showName: show.name,
    venue: show.venue ?? null,
    cityState: show.city_state ?? null,
    organizationName: org?.name ?? 'the production team',
    role,
    dates: [...dates].sort(),
  }
  const smsText = buildBookingRequestText(common)

  // Mark them as asked. Done before the email so a send failure cannot leave
  // the record claiming nobody was contacted when the link is already live.
  const ids = (timecards ?? []).map((t: any) => t.id).filter(Boolean)
  await supabase
    .from('timecards')
    .update({ booking_status: 'invited', booking_invited_at: new Date().toISOString() })
    .eq('crew_member_id', crewMemberId)
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])

  if (!crew.email) {
    // No address is an ordinary case, not an error: plenty of crew are reached
    // by text only. The link and the message are still returned.
    return NextResponse.json({ ok: true, emailed: false, link, smsText,
      warning: `${crew.full_name} has no email address. Text or copy the message instead.` })
  }

  const result = await sendBookingRequestEmail({ to: crew.email, ...common, link })
  if (result.error) {
    return NextResponse.json({ ok: true, emailed: false, link, smsText,
      warning: `The email didn't send (${result.error}). The link below still works.` })
  }

  return NextResponse.json({ ok: true, emailed: true, sentTo: crew.email, link, smsText })
}
