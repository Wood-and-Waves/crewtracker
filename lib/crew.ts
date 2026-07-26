import type { SupabaseClient } from '@supabase/supabase-js'

// Remove a crew member from the directory while PRESERVING their past show
// records. timecards keep their crew_member_name/role/day_rate/punches — we
// only null the FK link (crew_member_id) so the crew_members row can be deleted
// (rate_cards cascade). Reports group by crew_member_name, so historical hours
// and pay stay intact. Errors are returned, not swallowed.
export async function removeCrewMemberKeepHistory(
  supabase: SupabaseClient,
  crewMemberId: string,
): Promise<{ error: Error | null }> {
  const { error: tcError } = await supabase
    .from('timecards')
    .update({ crew_member_id: null })
    .eq('crew_member_id', crewMemberId)
  if (tcError) return { error: tcError }
  const { error: cmError } = await supabase.from('crew_members').delete().eq('id', crewMemberId)
  return { error: cmError }
}
