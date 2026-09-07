// Reading a PM invitation for the PUBLIC accept page.
//
// Plain module, no 'use client'. SERVICE ROLE, because the person opening the
// link may not be signed in yet — the unguessable token is the authorization,
// exactly as lib/bookingInvite.ts works. Same rule as there: explicit column
// lists, never select('*'). The page may show the show's name, dates, venue,
// the company and who named them. Not show_notes, job_number, client_company,
// nor anything about crew or rates.

import { createAdminClient } from '@/lib/supabase/admin'

export type PmInviteView = {
  token: string
  showId: string
  showName: string
  venue: string | null
  cityState: string | null
  startDate: string
  endDate: string
  organizationName: string
  inviterName: string | null
  pmName: string | null
  acceptedAt: string | null
  /** The show has since been given to somebody else; this link is dead. */
  replaced: boolean
}

export async function loadPmInvite(token: string): Promise<PmInviteView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return null
  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('pm_invites')
    .select('id, token, show_id, profile_id, organization_id, sent_by, accepted_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return null

  const [{ data: show }, { data: org }, { data: pm }, { data: inviter }] = await Promise.all([
    admin.from('shows').select('id, name, venue, city_state, start_date, end_date, pm_profile_id').eq('id', invite.show_id).maybeSingle(),
    admin.from('organizations').select('name').eq('id', invite.organization_id).maybeSingle(),
    admin.from('profiles').select('full_name').eq('id', invite.profile_id).maybeSingle(),
    invite.sent_by
      ? admin.from('profiles').select('full_name').eq('id', invite.sent_by).maybeSingle()
      : Promise.resolve({ data: null as { full_name: string | null } | null }),
  ])
  if (!show) return null

  return {
    token: invite.token,
    showId: show.id,
    showName: show.name,
    venue: show.venue ?? null,
    cityState: show.city_state ?? null,
    startDate: show.start_date,
    endDate: show.end_date,
    organizationName: org?.name ?? 'A production company',
    inviterName: inviter?.full_name ?? null,
    pmName: pm?.full_name ?? null,
    acceptedAt: invite.accepted_at ?? null,
    replaced: show.pm_profile_id !== invite.profile_id,
  }
}
