// Who is signed in, which organization they are acting in, and what they may do.
//
// SERVER ONLY. Deliberately no 'use client' — it imports the server Supabase
// client, and it exports non-component values, so a client component must never
// import it (CLAUDE.md "Past incidents": exporting a non-component value from a
// 'use client' file to a Server Component silently serialises into a broken
// reference). Pass the plain values it returns down as props instead.
//
// WHY THIS EXISTS
// ---------------
// 28 files each ran their own `select can_… from profiles where id = …`, with a
// different column subset in each. That was survivable while a login belonged to
// exactly one organization. It stops being survivable the moment a person can
// belong to several, because then "their permissions" is not a property of the
// person at all — it depends on which organization they are currently acting in,
// and 28 separate queries is 28 chances to forget that.
//
// This is the app-side twin of my_perm() in the database: one place that resolves
// caller -> active organization -> permissions. When the source of that answer
// moves from profiles to memberships, it moves here, once.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { PermissionKey, PermissionValues } from '@/lib/permissions'
import { ALL_PERMISSION_KEYS } from '@/lib/permissions'
import { resolveSession, type MembershipRow, type MyOrganization } from '@/lib/sessionResolve'

export type CurrentUser = {
  id: string
  email: string | null
  fullName: string | null
  /** The organization they are acting in right now. Null = not in one. */
  organizationId: string | null
  isSuperAdmin: boolean
  use24Hour: boolean
  shoulderSurfer: boolean
  /** Removed from their organization. Every org-scoped read returns nothing. */
  deactivated: boolean
  /**
   * Does the ACTIVE organization have the scheduling module?
   * An entitlement, not a permission — see canUseScheduling(), which is what
   * call sites should almost always ask.
   */
  schedulingEnabled: boolean
  /**
   * The active organization has been suspended by the operator. A commercial
   * state, not a security boundary (see app/dashboard/layout.tsx). Rides along
   * on the membership read so the layout needs no query of its own for it.
   */
  orgSuspended: boolean
  permissions: PermissionValues
  /** can('can_view_pay_rates') — reads better at call sites than permissions.x */
  can: (key: PermissionKey) => boolean
}

/**
 * ONE request-cached load for everything about the signed-in user.
 *
 * TWO ROUND TRIPS AFTER THE AUTH CHECK, NOT THREE IN A ROW (2026-10-04). It used
 * to be: validate the login → read the profile → read the ONE membership for
 * the profile's active company (which had to wait for the profile, because it
 * needed the pointer) → and then getMyOrganizations read ALL memberships for the
 * switcher, serial behind all of that even though the layout wrapped the two in
 * Promise.all. Measured on the live site at ~85 ms a round trip, that chain was
 * most of the ~400 ms every navigation paid before any page did its own work.
 *
 * Both data reads need only the login's id, so they run together: the profile,
 * and every membership this login holds with its organization embedded. Which
 * one is active is then decided in plain code — resolveSession() in
 * lib/sessionResolve.ts, pure and pinned by tests for the four cases that
 * matter: a stale pointer, a deactivated membership, a login in two companies,
 * a login in none. The rule it applies is the one that was always here: the
 * pointer grants nothing; a live membership in exactly that company must exist.
 *
 * The memberships read is filtered to this login's own rows TWICE — in the
 * query, and again inside resolveSession — because the memberships policy lets
 * an admin read their whole team, so RLS alone would not bound it. Nothing here
 * is a security boundary — RLS is — but the pick must still be the caller's.
 *
 * One read now feeds both the permissions and the switcher, so the deploy-order
 * rule in CLAUDE.md ("migrate first, then deploy") now empties the switcher too
 * if a permission column is missing, where before only getCurrentUser failed.
 */
const loadSession = cache(async function loadSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    // profiles holds person-level facts only. Which organization they are
    // acting in is a pointer; it grants nothing on its own.
    supabase
      .from('profiles')
      .select(
        `id, email, full_name, is_super_admin,
         use_24_hour_time, shoulder_surfer_mode, active_organization_id`,
      )
      .eq('id', user.id)
      .single(),
    // Every membership, deactivated ones included: a removed member keeps their
    // row so "who finalized this payroll report" survives them leaving, and the
    // UI needs to know "removed" from "never joined". The organization rides
    // along embedded, so the module entitlement, the suspension flag and the
    // switcher's names all land in the same round trip as the permissions.
    supabase
      .from('memberships')
      .select(
        `profile_id, organization_id, deactivated_at, organizations(id, name, scheduling_enabled, disabled_at), ${ALL_PERMISSION_KEYS.join(', ')}`,
      )
      .eq('profile_id', user.id),
  ])

  const row = (profile ?? {}) as Record<string, unknown>
  const resolved = resolveSession({
    profileId: user.id,
    activeOrganizationId: (row.active_organization_id as string) ?? null,
    memberships: (memberships ?? []) as unknown as MembershipRow[],
  })
  return { user, row, resolved }
})

/**
 * The signed-in user, or null if nobody is signed in.
 *
 * WRAPPED IN React.cache(): one answer per server request, shared by the layout
 * and the page, and sharing one loadSession() with getMyOrganizations so the
 * switcher costs nothing extra. cache() is per-request and holds nothing across
 * requests, so a permission change still takes effect on the next navigation.
 *
 * Returns permissions for their ACTIVE organization. A user with no
 * organization gets every permission false rather than null, so call sites can
 * ask `user.can(...)` without a null check and always get a safe answer.
 *
 * Note this is a convenience for rendering the UI, not a security boundary —
 * RLS is. A screen that hides a button is being tidy; the database is what
 * actually refuses the write. Never treat a false here as the only thing
 * standing between a user and an action.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await loadSession()
  if (!session) return null
  const { user, row, resolved } = session
  const { permissions } = resolved

  return {
    id: user.id,
    email: (row.email as string) ?? user.email ?? null,
    fullName: (row.full_name as string) ?? null,
    organizationId: resolved.organizationId,
    isSuperAdmin: row.is_super_admin === true,
    use24Hour: row.use_24_hour_time === true,
    shoulderSurfer: row.shoulder_surfer_mode === true,
    deactivated: resolved.deactivated,
    schedulingEnabled: resolved.schedulingEnabled,
    orgSuspended: resolved.orgSuspended,
    permissions,
    can: (key) => permissions[key] === true,
  }
})

export type { MyOrganization } from '@/lib/sessionResolve'

/**
 * Every organization the signed-in user can currently act in, for the switcher.
 *
 * Derived from the same rows getCurrentUser already loaded — no query of its
 * own since 2026-10-04. Deactivated memberships are excluded: being removed
 * from a company should take it out of your list, not leave a door that opens
 * onto an empty app. "Active" is the RESOLVED organization (a live membership),
 * matching my_organization_id(), not the raw pointer.
 *
 * Empty for someone in no organization, one entry for the ordinary case —
 * callers hide the switcher below two, since a "switch company" control
 * offering one company is just clutter.
 */
export const getMyOrganizations = cache(async function getMyOrganizations(): Promise<MyOrganization[]> {
  const session = await loadSession()
  return session ? session.resolved.organizations : []
})

/**
 * Whether the signed-in user may see money on a given show.
 *
 * Two independent gates, and it has been got wrong before by checking only one:
 * the SHOW must track finances at all, and the USER must be allowed to see pay
 * rates. Neither implies the other.
 */
export function canSeeFinancials(
  user: Pick<CurrentUser, 'can'> | null,
  showFinancials: boolean | null | undefined,
): boolean {
  return !!showFinancials && !!user?.can('can_view_pay_rates')
}

// canUseScheduling lives in lib/permissions.ts — it is pure, and this module is
// server-only. Re-exported here so call sites can reach it beside
// canSeeFinancials without caring where it is defined.
export { canUseScheduling } from '@/lib/permissions'

/**
 * PM-side on this show? (Section 2, 2026-09-06.) True when the caller can see
 * every show, created it, is its scheduler, or is on its access list — the
 * same set the database uses to decide whether they see everyone's rows or
 * only their own. False means crew-side: staffed, sees only themselves.
 * One RPC; the helper is STABLE and cheap. Accepts either row shape PostgREST
 * uses for a `setof uuid`.
 */
export async function isPmOnShow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  showId: string,
): Promise<boolean> {
  const { data } = await supabase.rpc('my_pm_show_ids')
  return Array.isArray(data) && data.some((row: any) =>
    (typeof row === 'string' ? row : row?.my_pm_show_ids) === showId)
}

/**
 * May this person WRITE to the show — rename it, retime it, mark it confirmed?
 *
 * A MIRROR OF THE `shows` UPDATE POLICY, and the only copy of it in TypeScript.
 * The policy reads:
 *
 *   organization_id = my_organization_id()
 *   AND my_perm('can_edit_timecards')
 *   AND ( can_see_all_shows()          -- which is my_perm('can_edit_all_shows')
 *         OR id IN (my show_assignments)
 *         OR created_by = auth.uid() )
 *
 * **If that policy gains an arm, this moves with it.** A second copy of a
 * visibility rule drifting from the first is a mistake this project has already
 * made twice — `timecard_day_rates` missed the scheduler arm in 0026, and the
 * 0035 cutover had to change the same rule in five places at once.
 *
 * This exists because being PM-SIDE is not the same as being able to write.
 * `isPmOnShow` is true for a SCHEDULER once a show has been sent to them, which
 * is what lets them open the Scheduling screen at all — but the UPDATE policy
 * deliberately has no scheduler arm, because sending a show to scheduling and
 * confirming it with the client are the show builder's acts. So a scheduler
 * must see the show's state and be offered no way to change it, rather than
 * being handed a control whose write matches no row.
 */
export async function canEditShow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  show: { id: string; created_by?: string | null },
  user: CurrentUser,
): Promise<boolean> {
  if (!user.permissions.can_edit_timecards) return false
  if (user.permissions.can_edit_all_shows) return true
  if (show.created_by && show.created_by === user.id) return true
  const { data } = await supabase
    .from('show_assignments').select('show_id').eq('show_id', show.id).eq('profile_id', user.id).limit(1)
  return !!data && data.length > 0
}

/**
 * A login with NO company permission at all — the `crew` preset (Section 3).
 * Such a person is only ever crew-side, so the parts of the app that exist
 * for running a company (the Directory, with everyone's phone numbers) are
 * not theirs to open. Deliberately a property of the permissions, not of
 * base_role: it is what the person can DO that decides.
 */
export function isCrewOnly(user: CurrentUser | null): boolean {
  if (!user) return false
  return ALL_PERMISSION_KEYS.every(k => !user.permissions[k])
}
