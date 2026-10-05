// Which company is this login acting in, and what may they do there?
//
// PURE. This is the decision that lib/session.ts used to make across three
// sequential database reads (profile → the one membership for the active
// company → every membership for the switcher). The reads are now two in
// parallel — the profile and ALL of this login's memberships — and the picking
// happens here, in plain code, where it can be tested.
//
// It is a separate file for one reason: lib/session.ts imports the server
// Supabase client, and importing that into a test drags in next/headers and
// dies (CLAUDE.md records this trap). Nothing here touches a server.
//
// THE RULE IT ENCODES HAS NOT CHANGED, and the tests exist to pin it. The
// profile's active_organization_id is a POINTER and grants nothing on its own:
// a live membership in exactly that company must exist, every time, or the
// login holds no permissions and no company. A deactivated membership still
// names the company (so "removed" renders as removed, not as "no company") but
// still grants nothing. This mirrors my_organization_id() in the database.
//
// NOT A SECURITY BOUNDARY — RLS is. This decides what the screens show and
// which company id the app writes against.
//
// IT FILTERS TO THE CALLER'S OWN ROWS ITSELF, because RLS does not. The
// memberships SELECT policy has an admin arm — somebody with can_manage_users
// can read every membership in their company, which is how the Team screen
// works — so "the rows arrived under the caller's session" is NOT a guarantee
// that they are the caller's. The loader filters on profile_id in the query,
// and this function filters on it again, so the pick is bounded by
// construction rather than by one clause in one query. Pinned by a test that
// hands it somebody else's row for the same company.

import type { PermissionKey, PermissionValues } from '@/lib/permissions'
import { ALL_PERMISSION_KEYS } from '@/lib/permissions'

export type OrgEmbed = {
  id?: string
  name?: string
  scheduling_enabled?: boolean
  disabled_at?: string | null
}

/** One row of `memberships`, with the organization embedded. PostgREST types a
 *  to-one embed as an object but sometimes returns it as a one-element array,
 *  so both shapes are accepted — the same dance every nested read does. */
export type MembershipRow = {
  profile_id: string
  organization_id: string
  deactivated_at?: string | null
  organizations?: OrgEmbed | OrgEmbed[] | null
} & Partial<Record<PermissionKey, boolean | null>>

export type MyOrganization = {
  id: string
  name: string
  isActive: boolean
}

export type ResolvedSession = {
  /** The company they are acting in. Null = none (no pointer, stale pointer,
   *  or removed from it). */
  organizationId: string | null
  /** Removed from the active company: the row exists, deactivated_at is set. */
  deactivated: boolean
  permissions: PermissionValues
  schedulingEnabled: boolean
  orgSuspended: boolean
  /** The switcher: every LIVE membership, by name, with the active one marked. */
  organizations: MyOrganization[]
}

export const NO_PERMISSIONS = Object.freeze(
  Object.fromEntries(ALL_PERMISSION_KEYS.map((k) => [k, false])),
) as PermissionValues

function orgOf(m: MembershipRow): OrgEmbed | null {
  const rel = m.organizations
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

export function resolveSession(input: {
  /** The signed-in login. Rows for anybody else are ignored, whatever RLS let through. */
  profileId: string
  activeOrganizationId: string | null
  memberships: MembershipRow[]
}): ResolvedSession {
  const { profileId, activeOrganizationId } = input
  const memberships = input.memberships.filter((m) => m.profile_id === profileId)

  // The pointer resolved against the rows — the row is found whether or not it
  // is deactivated, exactly as the old per-company query returned it.
  const membership = activeOrganizationId
    ? memberships.find((m) => m.organization_id === activeOrganizationId) ?? null
    : null

  const deactivated = !!membership && !!membership.deactivated_at
  const live = !!membership && !deactivated

  const permissions = live
    ? (Object.fromEntries(
        ALL_PERMISSION_KEYS.map((k) => [k, membership![k] === true]),
      ) as PermissionValues)
    : NO_PERMISSIONS

  const org = membership ? orgOf(membership) : null
  // Default TRUE when unknown: the column is `not null default true`, so the
  // only way to read undefined is a shape surprise, and failing OPEN on a
  // commercial entitlement is the right way round — a billing flag must never
  // silently hide a feature a customer is paying for.
  const schedulingEnabled = live ? org?.scheduling_enabled !== false : false
  const orgSuspended = live ? !!org?.disabled_at : false
  const organizationId = live ? membership!.organization_id ?? null : null

  // The switcher excludes deactivated memberships: being removed from a company
  // should take it out of your list, not leave a door onto an empty app.
  const organizations: MyOrganization[] = memberships
    .filter((m) => !m.deactivated_at)
    .map((m) => ({ m, org: orgOf(m) }))
    .filter((x): x is { m: MembershipRow; org: OrgEmbed & { name: string } } => !!x.org && typeof x.org.name === 'string')
    .map(({ m, org }) => ({ id: m.organization_id, name: org.name, isActive: m.organization_id === organizationId }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { organizationId, deactivated, permissions, schedulingEnabled, orgSuspended, organizations }
}
