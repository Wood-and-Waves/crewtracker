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

const NO_PERMISSIONS = Object.fromEntries(
  ALL_PERMISSION_KEYS.map((k) => [k, false]),
) as PermissionValues

/**
 * The signed-in user, or null if nobody is signed in.
 *
 * WRAPPED IN React.cache(): one answer per server request, shared by the layout
 * and the page. Before 2026-09-06 the dashboard layout and every page each
 * called this independently — three sequential round trips apiece, the first a
 * network call to the auth server — so a single tracker view validated the
 * same session four times (proxy + layout + getMyOrganizations + page).
 * Measured: ~20 Supabase round trips per page, re-paid on every
 * router.refresh(), i.e. after every punch. cache() is per-request and holds
 * nothing across requests, so a permission change still takes effect on the
 * next navigation exactly as before.
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // profiles holds person-level facts only. Which organization they are acting
  // in is a pointer; it grants nothing on its own.
  const { data: profile } = await supabase
    .from('profiles')
    .select(
      `id, email, full_name, is_super_admin,
       use_24_hour_time, shoulder_surfer_mode, active_organization_id`,
    )
    .eq('id', user.id)
    .single()

  const row = (profile ?? {}) as Record<string, unknown>
  const activeOrgId = (row.active_organization_id as string) ?? null

  // Resolve the pointer to a real membership. This mirrors my_organization_id()
  // in the database exactly, and for the same reason: the pointer is a stored
  // choice, and a stored choice is a way to serve the wrong organization's data
  // if it is ever trusted on its own. Both ends re-check that a live membership
  // for that specific organization exists, every time.
  //
  // maybeSingle(), not single(): "no membership for the active org" is an
  // ordinary state (never joined, just removed, stale pointer), not an error.
  //
  // organizations(scheduling_enabled) rides along as an embedded select rather
  // than a second query: the module entitlement is a property of the org the
  // caller is acting in, so it resolves at exactly the same moment their
  // permissions do, for no extra round trip.
  const { data: membership } = activeOrgId
    ? await supabase
        .from('memberships')
        .select(
          `organization_id, deactivated_at, organizations(scheduling_enabled, disabled_at), ${ALL_PERMISSION_KEYS.join(', ')}`,
        )
        .eq('profile_id', user.id)
        .eq('organization_id', activeOrgId)
        .maybeSingle()
    : { data: null }

  const m = (membership ?? {}) as Record<string, unknown>
  // A deactivated member keeps their row so that "who finalized this payroll
  // report" survives them leaving, but they hold nothing. Matching the database,
  // which returns null from my_organization_id() for them, means the UI stops
  // rendering an organization's chrome around screens RLS has already emptied.
  const deactivated = !!membership && !!m.deactivated_at
  const live = !!membership && !deactivated

  const permissions = live
    ? (Object.fromEntries(
        ALL_PERMISSION_KEYS.map((k) => [k, m[k] === true]),
      ) as PermissionValues)
    : NO_PERMISSIONS

  // PostgREST returns an embedded to-one relation as an object, but types it as
  // an array often enough that both shapes have to be handled — the same dance
  // every `rooms!inner(work_days!inner(...))` read in this app does.
  const orgRel = m.organizations as
    | { scheduling_enabled?: boolean; disabled_at?: string | null }
    | { scheduling_enabled?: boolean; disabled_at?: string | null }[]
    | null
  const org = Array.isArray(orgRel) ? orgRel[0] : orgRel
  // Default TRUE when unknown: the column is `not null default true`, so the
  // only way to read undefined here is a shape surprise, and failing OPEN on a
  // commercial entitlement is the right way round — a billing flag must never be
  // able to silently hide a feature a customer is paying for.
  const schedulingEnabled = live ? org?.scheduling_enabled !== false : false
  const orgSuspended = live ? !!org?.disabled_at : false

  return {
    id: user.id,
    email: (row.email as string) ?? user.email ?? null,
    fullName: (row.full_name as string) ?? null,
    organizationId: live ? ((m.organization_id as string) ?? null) : null,
    isSuperAdmin: row.is_super_admin === true,
    use24Hour: row.use_24_hour_time === true,
    shoulderSurfer: row.shoulder_surfer_mode === true,
    deactivated,
    schedulingEnabled,
    orgSuspended,
    permissions,
    can: (key) => permissions[key] === true,
  }
})

export type MyOrganization = {
  id: string
  name: string
  isActive: boolean
}

/**
 * Every organization the signed-in user can currently act in, for the switcher.
 *
 * Deactivated memberships are excluded: being removed from a company should take
 * it out of your list, not leave a door that opens onto an empty app.
 *
 * Returns an empty array for someone in no organization, and a single entry for
 * the ordinary case — callers should hide the switcher entirely below two, since
 * a "switch company" control offering one company is just clutter.
 */
export const getMyOrganizations = cache(async function getMyOrganizations(): Promise<MyOrganization[]> {
  // Reuses the request-cached user rather than re-validating the session and
  // re-reading profiles — this used to be a second auth round trip plus two
  // duplicate table reads on every dashboard render. "Active" is the RESOLVED
  // organization (a live membership), matching my_organization_id(), not the
  // raw pointer — a stale pointer must never mark a company you were removed
  // from as the active one.
  const user = await getCurrentUser()
  if (!user) return []
  const supabase = await createClient()

  const { data } = await supabase
    .from('memberships')
    .select('organization_id, deactivated_at, organizations(id, name)')
    .eq('profile_id', user.id)
    .is('deactivated_at', null)

  type Row = { organization_id: string; organizations: { id: string; name: string } | null }

  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.organizations)
    .map((r) => ({
      id: r.organization_id,
      name: r.organizations!.name,
      isActive: r.organization_id === user.organizationId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
