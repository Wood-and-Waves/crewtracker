import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSuperAdminId } from '@/lib/superadmin'

// Switch the scheduling module on or off for an organization.
//
// Same shape and same reasoning as org-status: guard_organization_disabled_at
// (which guards scheduling_enabled too, despite its name) refuses any change
// whenever there is an authenticated user in context. That is what stops a
// customer's own admin from switching on a feature they have not paid for —
// organizations' UPDATE policy is column-blind, so without the trigger every
// org admin could write this column directly. The service role has no
// auth.uid() and passes, which makes THIS ROUTE the privilege; its only gate is
// the super-admin check below.
//
// Kept separate from org-status rather than folded into it: suspension and
// entitlement are different decisions with different consequences, and a single
// route taking a "what shall I change" argument is how the wrong one gets
// changed.
//
// Nothing is deleted when this goes false. Positions, booking history and
// crew_call rows all stay exactly where they are; the app simply stops showing
// the module. Switching back on restores the feature whole.

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
  // Explicit boolean rather than truthiness: `enabled: undefined` from a
  // malformed caller must not silently read as "switch it off".
  if (!orgId || typeof body?.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'An organization id and an enabled boolean are required.' },
      { status: 400 },
    )
  }
  const enabled: boolean = body.enabled

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organizations')
    .update({ scheduling_enabled: enabled })
    .eq('id', orgId)
    .select('id')

  if (error) {
    console.error('org-scheduling: update failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No such organization.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, schedulingEnabled: enabled })
}
