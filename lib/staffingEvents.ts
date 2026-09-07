// The digest's diary. Every staffing write that matters to a PM — booked,
// accepted, declined, released, moved, extended, days changed — drops one row
// here (migration 0035, staffing_events). app/api/digest reads the unsent
// rows once a day, builds one email per show, and marks them sent.
//
// Plain module, no 'use client': called from browser writers (the tracker's
// own supabase client) and from server routes (the admin client), so the
// client parameter is typed structurally — just "has a .from()" — rather than
// pinned to either @supabase/supabase-js or @supabase/ssr's client type.
//
// BEST-EFFORT, ALWAYS. This runs after the write it is annotating has already
// landed — a failure here must never make that write look like it failed, and
// must never throw into a caller that isn't expecting it. console.error and
// move on.

export type StaffingEventKind =
  | 'booked'
  | 'accepted'
  | 'declined'
  | 'released'
  | 'days_changed'
  | 'moved'
  | 'extended'

export type StaffingEventInput = {
  showId: string
  kind: StaffingEventKind
  crewMemberId?: string | null
  crewMemberName: string
  role?: string | null
  /** Already formatted, e.g. "Tue 8 – Thu 10" — use compressDays() from lib/readyEmail. */
  days?: string | null
}

export async function logStaffingEvent(
  client: { from: (table: string) => any },
  input: StaffingEventInput,
): Promise<void> {
  try {
    const { error } = await client.from('staffing_events').insert({
      show_id: input.showId,
      kind: input.kind,
      crew_member_id: input.crewMemberId ?? null,
      crew_member_name: input.crewMemberName,
      role: input.role ?? null,
      days: input.days ?? null,
    })
    if (error) console.error('logStaffingEvent failed:', error)
  } catch (e) {
    console.error('logStaffingEvent threw:', e)
  }
}
