import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSuperAdminId } from '@/lib/superadmin'

// Suspend or re-enable an organization.
//
// Has to run server-side with the service role: guard_organization_disabled_at
// refuses any change to disabled_at whenever there's an authenticated user in
// context, which is what stops a suspended org's own admin from lifting it.
// The service role has no auth.uid(), so it passes — meaning this route IS the
// privilege, and its only gate is the super-admin check below.

export async function POST(request: Request) {
  const supabase = await createClient()
  if (!(await getSuperAdminId(supabase as any))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const orgId = typeof body?.orgId === 'string' ? body.orgId : null
  const suspend = body?.suspend === true
  if (!orgId) {
    return NextResponse.json({ error: 'An organization id is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('organizations')
    .update({ disabled_at: suspend ? new Date().toISOString() : null })
    .eq('id', orgId)

  if (error) {
    console.error('org-status: update failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, suspended: suspend })
}
