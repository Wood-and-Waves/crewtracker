// Whose days changed without anybody telling them.
//
// The prompt to tell somebody lives in the confirm bar that appears right
// after a change, and it dies when the scheduler navigates away — so until
// 2026-09-09 a person's days could change and nothing anywhere recorded that
// nobody had passed it on. staffing_events.crew_told_at (migration 0040) is
// that record; this module is the rule for reading it.
//
// Plain module, no 'use client': the Scheduling page (a Server Component)
// imports the query, and the pure half is unit-tested.

import type { StaffingEventKind } from '@/lib/staffingEvents'

/**
 * The changes a crew member needs telling about.
 *
 * Dan, 2026-09-09: "Any date change needs telling. Adding or subtracting."
 *
 * Deliberately NOT here: `booked`, because the booking request is how somebody
 * is told they are on a show at all — counting it would ask you to tell them
 * twice — and `accepted` / `declined`, which are the crew member's own answers.
 */
export const NOTIFIABLE_KINDS: readonly StaffingEventKind[] = [
  'moved', 'released', 'extended', 'days_changed',
]

/** One untold staffing event, as read from the database. */
export type UntoldRow = {
  id: string
  kind: string
  crew_member_id: string | null
  crew_member_name: string
  days: string | null
}

/** One person owed a word, and how many changes are behind it. */
export type UntoldPerson = { crewMemberId: string; name: string; count: number }

/**
 * The people, not the events. Somebody moved three times is one person to
 * tell, and the notice they get lists their whole revised schedule anyway.
 *
 * A row with no crew_member_id is dropped: a hand-typed name has no directory
 * entry and therefore no email address, so it would be a number no button
 * could ever clear.
 */
export function summarizeUntold(rows: UntoldRow[]): UntoldPerson[] {
  const byPerson = new Map<string, UntoldPerson>()
  for (const r of rows) {
    if (!r.crew_member_id) continue
    if (!(NOTIFIABLE_KINDS as readonly string[]).includes(r.kind)) continue
    const person = byPerson.get(r.crew_member_id)
      ?? { crewMemberId: r.crew_member_id, name: r.crew_member_name, count: 0 }
    person.count++
    byPerson.set(r.crew_member_id, person)
  }
  return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Just enough of a Supabase client to read a table — see lib/staffingEvents.ts
 *  for why this is structural rather than pinned to one client type. */
type SupabaseLike = { from: (table: string) => any }

/**
 * The people owed a word on this show.
 *
 * SCOPING IS RLS: staffing_events' SELECT policy is "the show is one you can
 * see", so a scheduler's own session returns only shows they are entitled to
 * and there is nothing extra to check here.
 */
export async function fetchUntold(supabase: SupabaseLike, showId: string): Promise<UntoldPerson[]> {
  const { data } = await supabase
    .from('staffing_events')
    .select('id, kind, crew_member_id, crew_member_name, days')
    .eq('show_id', showId)
    .is('crew_told_at', null)
    .in('kind', NOTIFIABLE_KINDS as unknown as string[])
  return summarizeUntold((data ?? []) as UntoldRow[])
}
