// The scheduling queue: sent shows that still need a scheduler's hands.
// Plain module. Scoping is RLS: a scheduler's session only returns sent shows.

export type QueueRow = {
  id: string; name: string; venue: string | null; startDate: string; endDate: string; sentAt: string
  openSlots: number; totalSlots: number; waiting: number; flags: number
}
export type QueueSummary = { open: number; total: number; waiting: number; flags: number }

/** Pure: per show, open slots, slots total, bookings waiting on a reply, flags. */
export function summarizeQueue(
  slots: { showId: string; filled: boolean; status: string | null }[],
  flags: { showId: string }[],
): Map<string, QueueSummary> {
  const m = new Map<string, QueueSummary>()
  const at = (id: string) => m.get(id) ?? (m.set(id, { open: 0, total: 0, waiting: 0, flags: 0 }), m.get(id)!)
  for (const s of slots) {
    const q = at(s.showId); q.total++
    if (!s.filled) q.open++
    else if (s.status === 'pencilled' || s.status === 'invited') q.waiting++
  }
  for (const f of flags) at(f.showId).flags++
  return m
}

export async function fetchSchedulingQueue(supabase: { from: (t: string) => any }): Promise<QueueRow[]> {
  const { data: shows } = await supabase.from('shows')
    .select('id, name, venue, start_date, end_date, sent_to_scheduling_at')
    .not('sent_to_scheduling_at', 'is', null).is('finalized_at', null).not('archived', 'is', true)
    .order('sent_to_scheduling_at', { ascending: true })
  const ids = (shows ?? []).map((s: any) => s.id as string)
  if (!ids.length) return []
  const [{ data: slots }, { data: flags }] = await Promise.all([
    supabase.from('crew_call_positions')
      .select('id, rooms!inner(show_id), timecards(booking_status)').in('rooms.show_id', ids),
    supabase.from('position_slot_flags').select('show_id').in('show_id', ids),
  ])
  const summary = summarizeQueue(
    ((slots ?? []) as any[]).map(p => {
      const room = Array.isArray(p.rooms) ? p.rooms[0] : p.rooms
      const live = ((p.timecards ?? []) as any[]).find(t => t.booking_status !== 'declined')
      return { showId: room?.show_id, filled: !!live, status: live?.booking_status ?? null }
    }),
    ((flags ?? []) as any[]).map(f => ({ showId: f.show_id })),
  )
  return (shows ?? []).map((s: any) => {
    const q = summary.get(s.id) ?? { open: 0, total: 0, waiting: 0, flags: 0 }
    return { id: s.id, name: s.name, venue: s.venue ?? null, startDate: s.start_date, endDate: s.end_date,
      sentAt: s.sent_to_scheduling_at, openSlots: q.open, totalSlots: q.total, waiting: q.waiting, flags: q.flags }
  }).filter((r: QueueRow) => r.openSlots > 0 || r.flags > 0 || r.waiting > 0)
}
