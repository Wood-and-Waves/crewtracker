// The scheduling queue: sent shows that still need a scheduler's hands.
// Plain module. Scoping is RLS: a scheduler's session only returns sent shows.

export type QueueRow = {
  id: string; name: string; venue: string | null; startDate: string; endDate: string; sentAt: string
  openSlots: number; totalSlots: number; waiting: number; flags: number
}
export type QueueSummary = { open: number; total: number; waiting: number; flags: number }

/**
 * Pure: per show, open slots, slots total, PEOPLE waiting on a reply, flags.
 * A slot is one person on one day, so slots are counted as slots — but
 * "waiting" is people, not person-days: three crew over four days read as
 * "12 waiting" until 2026-09-07, and Dan rightly called it misleading. `person`
 * is whatever identifies the booking's person (crew id, else name); a slot
 * without one counts once.
 */
export function summarizeQueue(
  slots: { showId: string; filled: boolean; status: string | null; person?: string | null }[],
  flags: { showId: string }[],
): Map<string, QueueSummary> {
  const m = new Map<string, QueueSummary>()
  const waitingPeople = new Map<string, Set<string>>()
  const at = (id: string) => m.get(id) ?? (m.set(id, { open: 0, total: 0, waiting: 0, flags: 0 }), m.get(id)!)
  slots.forEach((s, i) => {
    const q = at(s.showId); q.total++
    if (!s.filled) q.open++
    else if (s.status === 'pencilled' || s.status === 'invited') {
      const set = waitingPeople.get(s.showId) ?? new Set<string>()
      set.add(s.person ?? `row-${i}`)
      waitingPeople.set(s.showId, set)
      q.waiting = set.size
    }
  })
  for (const f of flags) at(f.showId).flags++
  return m
}

export async function fetchSchedulingQueue(supabase: { from: (t: string) => any }): Promise<QueueRow[]> {
  // A day of slack either side is fine here — this hides shows that have
  // wrapped, not a payroll boundary, so UTC "today" is acceptable even though
  // it can be off by a day in the show's own timezone.
  const today = new Date().toISOString().slice(0, 10)
  const { data: shows } = await supabase.from('shows')
    .select('id, name, venue, start_date, end_date, sent_to_scheduling_at')
    .not('sent_to_scheduling_at', 'is', null).is('finalized_at', null).not('archived', 'is', true)
    .gte('end_date', today)
    .order('sent_to_scheduling_at', { ascending: true })
  const ids = (shows ?? []).map((s: any) => s.id as string)
  if (!ids.length) return []
  const [{ data: slots }, { data: flags }] = await Promise.all([
    supabase.from('crew_call_positions')
      .select('id, rooms!inner(show_id), timecards(booking_status, crew_member_id, crew_member_name)').in('rooms.show_id', ids),
    supabase.from('position_slot_flags').select('show_id').in('show_id', ids),
  ])
  const summary = summarizeQueue(
    ((slots ?? []) as any[]).map(p => {
      const room = Array.isArray(p.rooms) ? p.rooms[0] : p.rooms
      const live = ((p.timecards ?? []) as any[]).find(t => t.booking_status !== 'declined')
      return { showId: room?.show_id, filled: !!live, status: live?.booking_status ?? null, person: live?.crew_member_id ?? live?.crew_member_name ?? null }
    }),
    ((flags ?? []) as any[]).map(f => ({ showId: f.show_id })),
  )
  return (shows ?? []).map((s: any) => {
    const q = summary.get(s.id) ?? { open: 0, total: 0, waiting: 0, flags: 0 }
    return { id: s.id, name: s.name, venue: s.venue ?? null, startDate: s.start_date, endDate: s.end_date,
      sentAt: s.sent_to_scheduling_at, openSlots: q.open, totalSlots: q.total, waiting: q.waiting, flags: q.flags }
  }).filter((r: QueueRow) => r.openSlots > 0 || r.flags > 0 || r.waiting > 0)
}
