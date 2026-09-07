import type { SupabaseClient } from '@supabase/supabase-js'
import { buildReadyEmail, compressDays, sendReadyEmail } from '@/lib/readyEmail'
import { describeShowDates } from '@/lib/pmInviteEmail'
import { dayLabel } from '@/lib/dayActivities'
import { siteOrigin } from '@/lib/siteOrigin'

// THE ONE PLACE the ready email is decided. Called after anything that can
// complete a show: a crew confirmation (/api/bookings/respond) and a PM
// accepting (/api/pm/accept). Idempotent by ready_email_sent_at; a show that
// later reopens a slot does not unsend or resend it.
export async function maybeSendReadyEmail(admin: SupabaseClient, showId: string): Promise<{ sent: boolean; reason: string }> {
  const { data: show } = await admin.from('shows')
    .select('id, name, venue, city_state, start_date, end_date, organization_id, pm_profile_id, pm_accepted_at, ready_email_sent_at, finalized_at, archived')
    .eq('id', showId).maybeSingle()
  if (!show) return { sent: false, reason: 'no show' }
  if (show.ready_email_sent_at) return { sent: false, reason: 'already sent' }
  if (!show.pm_profile_id || !show.pm_accepted_at) return { sent: false, reason: 'no accepted PM' }
  if (show.finalized_at || show.archived) return { sent: false, reason: 'closed' }

  const [{ data: slots }, { data: cards }] = await Promise.all([
    admin.from('crew_call_positions').select('id, rooms!inner(show_id), timecards(booking_status)').eq('rooms.show_id', showId),
    admin.from('timecards')
      .select('id, crew_member_name, role, booking_status, crew_member_id, crew_members(phone), rooms!inner(name, work_days!inner(date, activities))')
      .eq('show_id', showId).neq('booking_status', 'declined'),
  ])
  const open = ((slots ?? []) as any[]).filter(p => !((p.timecards ?? []) as any[]).some(t => t.booking_status !== 'declined')).length
  const waiting = ((cards ?? []) as any[]).filter(t => t.booking_status === 'pencilled' || t.booking_status === 'invited').length
  if (open > 0 || waiting > 0) return { sent: false, reason: `${open} open, ${waiting} waiting` }

  const [{ data: pm }, { data: org }] = await Promise.all([
    admin.from('profiles').select('email, full_name').eq('id', show.pm_profile_id).maybeSingle(),
    admin.from('organizations').select('name').eq('id', show.organization_id).maybeSingle(),
  ])
  if (!pm?.email) return { sent: false, reason: 'PM has no email' }

  // Roster by day and room; each person's days across the show.
  const byDate = new Map<string, { label: string; rooms: Map<string, { name: string; role: string | null; phone: string | null }[]> }>()
  const daysByPerson = new Map<string, { name: string; role: string | null; dates: Set<string> }>()
  for (const t of (cards ?? []) as any[]) {
    const room = Array.isArray(t.rooms) ? t.rooms[0] : t.rooms
    const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
    const cm = Array.isArray(t.crew_members) ? t.crew_members[0] : t.crew_members
    if (!wd?.date) continue
    // dayLabel returns null for "nothing set" — coerced to '' here since
    // ReadyEmailInput's label is a plain string (buildReadyEmail already
    // treats a falsy label as "nothing to say" and omits it from the line).
    const day = byDate.get(wd.date) ?? { label: dayLabel(wd.activities ?? []) ?? '', rooms: new Map() }
    const people = day.rooms.get(room.name) ?? []
    people.push({ name: t.crew_member_name, role: t.role ?? null, phone: cm?.phone ?? null })
    day.rooms.set(room.name, people); byDate.set(wd.date, day)
    const key = `${t.crew_member_name}|${t.role ?? ''}`
    const p = daysByPerson.get(key) ?? { name: t.crew_member_name, role: t.role ?? null, dates: new Set<string>() }
    p.dates.add(wd.date); daysByPerson.set(key, p)
  }
  const input = {
    to: pm.email, pmName: pm.full_name ?? null, showName: show.name,
    dates: describeShowDates(show.start_date, show.end_date), venue: show.venue || show.city_state || null,
    orgName: org?.name ?? 'Your company', link: `${siteOrigin()}/dashboard/shows/${show.id}`,
    days: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({
      date, label: d.label,
      rooms: [...d.rooms.entries()].map(([name, people]) => ({ name, people: people.sort((x, y) => x.name.localeCompare(y.name)) })),
    })),
    perPerson: [...daysByPerson.values()].sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ name: p.name, role: p.role, days: compressDays([...p.dates]) })),
    waiting: 0,
  }
  const { error } = await sendReadyEmail(input)
  if (error) return { sent: false, reason: error }
  await admin.from('shows').update({ ready_email_sent_at: new Date().toISOString() }).eq('id', show.id)
  return { sent: true, reason: 'sent' }
}
