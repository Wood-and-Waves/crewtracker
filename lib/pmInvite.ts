// Reading a PM invitation for the PUBLIC accept page.
//
// Plain module, no 'use client'. SERVICE ROLE, because the person opening the
// link may not be signed in yet — the unguessable token is the authorization,
// exactly as lib/bookingInvite.ts works. Same rule as there: explicit column
// lists, never select('*'). The page may show the show's name, dates, venue,
// the company and who named them. Not show_notes, job_number, client_company,
// nor anything about crew or rates.

import { createAdminClient } from '@/lib/supabase/admin'
import { maybeSendReadyEmail, isExpectedReadyReason } from '@/lib/showReadiness'
import { sendPmDeclinedEmail } from '@/lib/pmInviteEmail'

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
  /** They said no. The invitation stays open so it can be reversed (0039). */
  declinedAt: string | null
  declinedNote: string | null
  /** Somebody ELSE holds this show now; this link is dead. A declined
   *  invitation points at nobody and must still open — see 0039. */
  replaced: boolean
  /** The run, day by day, so the page can say what the show actually IS.
   *  Dates and what happens on them — never crew, never money. */
  days: { date: string; activities: string[] }[]
}

export async function loadPmInvite(token: string): Promise<PmInviteView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return null
  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('pm_invites')
    .select('id, token, show_id, profile_id, organization_id, sent_by, accepted_at, declined_at, declined_note')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return null

  const [{ data: show }, { data: org }, { data: pm }, { data: inviter }, { data: days }] = await Promise.all([
    admin.from('shows').select('id, name, venue, city_state, start_date, end_date, pm_profile_id').eq('id', invite.show_id).maybeSingle(),
    admin.from('organizations').select('name').eq('id', invite.organization_id).maybeSingle(),
    admin.from('profiles').select('full_name').eq('id', invite.profile_id).maybeSingle(),
    invite.sent_by
      ? admin.from('profiles').select('full_name').eq('id', invite.sent_by).maybeSingle()
      : Promise.resolve({ data: null as { full_name: string | null } | null }),
    admin.from('work_days').select('date, activities').eq('show_id', invite.show_id).order('date'),
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
    declinedAt: invite.declined_at ?? null,
    declinedNote: invite.declined_note ?? null,
    replaced: !!show.pm_profile_id && show.pm_profile_id !== invite.profile_id,
    days: (days ?? []).map(d => ({ date: d.date as string, activities: (d.activities ?? []) as string[] })),
  }
}

// ---------------------------------------------------------------------------
// Answering the invitation
// ---------------------------------------------------------------------------
//
// Both answers live here rather than in the routes, because since 2026-09-08
// there are TWO ways in: the POST from the page's button, and the emailed link
// itself, which accepts as the page loads (Dan: "I would like the accept from
// the email to be an actual accept"). One implementation, two callers.
//
// ACCEPTING FROM A LINK IS A CONSIDERED TRADE. A mail scanner that fetches
// every URL in a message — Outlook Safe Links and friends — will accept on the
// person's behalf before they read it. That is why the page it lands on says
// what just happened in plain words and carries a DECLINE button with a note
// field: the person can undo it the moment they see it, and whoever named them
// is told, with the note. Nothing else in this app accepts on a GET.

export type AcceptResult =
  | { ok: true; showId: string }
  | { ok: false; status: number; error: string }

export async function acceptPmInvite(token: string): Promise<AcceptResult> {
  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('pm_invites')
    .select('id, show_id, profile_id, organization_id, accepted_at, declined_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return { ok: false, status: 404, error: 'This link is not valid.' }
  if (invite.accepted_at && !invite.declined_at) return { ok: true, showId: invite.show_id }

  const { data: show } = await admin.from('shows').select('id, pm_profile_id').eq('id', invite.show_id).maybeSingle()
  if (!show) return { ok: false, status: 404, error: 'That show no longer exists.' }
  // Somebody ELSE holds it: this link is dead however it was answered before.
  if (show.pm_profile_id && show.pm_profile_id !== invite.profile_id) {
    return { ok: false, status: 410, error: 'This invitation has been replaced. Check with whoever named you.' }
  }
  // REVERSING A DECLINE (0039). They said no, the show went back to having no
  // PM, and now they can do it after all — so accepting re-points the show at
  // them rather than refusing because it points at nobody.
  const reversing = !show.pm_profile_id
  const { data: member } = await admin
    .from('memberships').select('profile_id')
    .eq('profile_id', invite.profile_id).eq('organization_id', invite.organization_id)
    .is('deactivated_at', null).maybeSingle()
  if (!member) return { ok: false, status: 403, error: 'Your membership of this company is no longer active.' }

  const now = new Date().toISOString()

  // The grant. A hand-granted assignment may already exist; then there is
  // nothing to add and nothing to relabel.
  const { data: existing } = await admin
    .from('show_assignments').select('id').eq('show_id', show.id).eq('profile_id', invite.profile_id).maybeSingle()
  if (!existing) {
    const { error } = await admin
      .from('show_assignments')
      .insert({ show_id: show.id, profile_id: invite.profile_id, source: 'pm' })  // organization_id: its trigger
    if (error) return { ok: false, status: 500, error: error.message }
  }

  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    admin.from('pm_invites').update({ accepted_at: now, declined_at: null, declined_note: null }).eq('id', invite.id),
    admin.from('shows').update({
      pm_accepted_at: now,
      ...(reversing ? { pm_profile_id: invite.profile_id, pm_invited_at: now } : {}),
    }).eq('id', show.id),
  ])
  if (e1 || e2) return { ok: false, status: 500, error: (e1 ?? e2)!.message }

  // The show may already have been fully staffed before the PM accepted —
  // that's the second path into the ready email. Never fails accepting.
  const { sent, reason } = await maybeSendReadyEmail(admin, show.id)
  if (!sent && !isExpectedReadyReason(reason)) {
    console.error('maybeSendReadyEmail failed after a PM accept:', reason)
  }

  return { ok: true, showId: show.id }
}

export type DeclineResult =
  | { ok: true; showName: string; told: string | null }
  | { ok: false; status: number; error: string }

/**
 * Saying no. The show goes back to having NO production manager — the pointer,
 * the stamps, the invitation and any access granted by accepting are all
 * removed, so the show tells the truth rather than showing somebody who said
 * no. Whoever named them is emailed, with the person's note if they left one.
 *
 * Note that a decline leaves no record on the show itself. If "we asked Jordan
 * and he said no" ever needs to survive, that is a column and a migration —
 * deliberately not built for one, since the email carries the news to the one
 * person who acts on it.
 */
export async function declinePmInvite(token: string, note?: string | null): Promise<DeclineResult> {
  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('pm_invites')
    .select('id, show_id, profile_id, organization_id, sent_by')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return { ok: false, status: 404, error: 'This link is not valid.' }

  const [{ data: show }, { data: pm }, { data: org }] = await Promise.all([
    admin.from('shows').select('id, name, start_date, end_date, pm_profile_id').eq('id', invite.show_id).maybeSingle(),
    admin.from('profiles').select('full_name, email').eq('id', invite.profile_id).maybeSingle(),
    admin.from('organizations').select('name').eq('id', invite.organization_id).maybeSingle(),
  ])
  if (!show) return { ok: false, status: 404, error: 'That show no longer exists.' }
  if (show.pm_profile_id && show.pm_profile_id !== invite.profile_id) {
    return { ok: false, status: 410, error: 'This invitation has already been replaced.' }
  }
  // Already declined. Nothing to undo — but a NOTE arriving now is the reason
  // they came back to write, so it is recorded and sent on its own.
  if (!show.pm_profile_id) {
    const text = (note ?? '').trim()
    if (!text) return { ok: true, showName: show.name, told: null }
    await admin.from('pm_invites').update({ declined_note: text }).eq('id', invite.id)
    let toldLate: string | null = null
    if (invite.sent_by) {
      const { data: inviter } = await admin.from('profiles').select('full_name, email').eq('id', invite.sent_by).maybeSingle()
      if (inviter?.email) {
        const { error: mailError } = await sendPmDeclinedEmail({
          to: inviter.email,
          inviterName: inviter.full_name ?? null,
          pmName: pm?.full_name ?? 'They',
          showName: show.name,
          orgName: org?.name ?? 'Your company',
          note: text,
        })
        if (mailError) console.error('pm decline note: it did not send:', mailError)
        else toldLate = inviter.email
      }
    }
    return { ok: true, showName: show.name, told: toldLate }
  }

  // Undo everything the invitation created, including an acceptance that a mail
  // scanner may have made on their behalf. The SHOW goes back to having no PM;
  // the INVITATION stays, carrying the answer, so the decline can be reversed
  // and a note added afterwards (0039).
  await admin.from('show_assignments').delete()
    .eq('show_id', show.id).eq('profile_id', invite.profile_id).eq('source', 'pm')
  const { error } = await admin.from('shows')
    .update({ pm_profile_id: null, pm_invited_at: null, pm_accepted_at: null }).eq('id', show.id)
  if (error) return { ok: false, status: 500, error: error.message }
  await admin.from('pm_invites')
    .update({ declined_at: new Date().toISOString(), accepted_at: null, declined_note: (note ?? '').trim() || null })
    .eq('id', invite.id)

  // Tell whoever named them. Best effort: the decline itself has happened, and
  // a failed email must not make it look otherwise.
  let told: string | null = null
  if (invite.sent_by) {
    const { data: inviter } = await admin.from('profiles').select('full_name, email').eq('id', invite.sent_by).maybeSingle()
    if (inviter?.email) {
      const { error: mailError } = await sendPmDeclinedEmail({
        to: inviter.email,
        inviterName: inviter.full_name ?? null,
        pmName: pm?.full_name ?? 'They',
        showName: show.name,
        orgName: org?.name ?? 'Your company',
        note: (note ?? '').trim() || null,
      })
      if (mailError) console.error('pm decline: the notice did not send:', mailError)
      else told = inviter.email
    }
  }

  return { ok: true, showName: show.name, told }
}
