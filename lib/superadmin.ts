// Platform-operator check, in one place.
//
// This used to be a UUID pasted into two files. Both of those surfaces run with
// the SERVICE ROLE, which bypasses row-level security entirely — so that
// constant was the only thing standing between a signed-in user and every
// organization's data. Two copies of a security check is one too many, and
// changing who holds it required a code deploy.
//
// It now reads profiles.is_super_admin, which the app cannot set: a trigger
// refuses any change whenever there's an authenticated user in context, so it
// can only be granted by direct SQL (see
// scripts/sql/applied/superadmin-and-org-disable.sql).
//
// Plain module, no 'use client' — imported by Server Components and route
// handlers (see CLAUDE.md on the client/server export rule).

type ServerClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
  from: (table: string) => any
}

/**
 * The signed-in user's id if they are a platform operator, otherwise null.
 * Callers decide what to do with null — redirect for a page, 403 for a route.
 */
export async function getSuperAdminId(supabase: ServerClient): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  return profile?.is_super_admin ? user.id : null
}
