import AppShell from '@/components/AppShell'
import Card from '@/components/ui/Card'
import Logo from '@/components/Logo'
import SignOutButton from '@/components/SignOutButton'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, getMyOrganizations } from '@/lib/session'
// Read server-side and passed down as a string: importing package.json into a
// client component would bundle the whole dependency list into the browser.
import { version as APP_VERSION } from '@/package.json'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  const organizations = await getMyOrganizations()

  const canManageUsers = user?.can('can_manage_users') ?? false
  const isSuperAdmin = user?.isSuperAdmin ?? false
  const userName = user?.fullName ?? undefined
  // getCurrentUser() reports no organization for a DEACTIVATED member, matching
  // my_organization_id() in the database. That is a small, deliberate
  // improvement: previously a removed teammate got the full app shell wrapped
  // around screens that RLS had already emptied, with no explanation. They now
  // land on the "Almost there" screen below, which at least has a way out.
  const hasOrg = !!user?.organizationId

  let orgSuspended = false
  if (user?.organizationId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('disabled_at')
      .eq('id', user.organizationId)
      .single()
    orgSuspended = !!org?.disabled_at
  }

  // A suspended organization is a commercial state, not a security boundary —
  // the data still belongs to the customer and an operator can lift it at any
  // time. So this blocks the app rather than the database: every dashboard route
  // renders through this layout, so there's no page to reach around it, and
  // re-enabling takes effect on the next request with nothing to clean up.
  // Deliberately NOT enforced in RLS, which would also cut off the exports and
  // final report a customer may still be owed.
  // Both dead ends render outside AppShell, so they must carry their own way
  // out. Every other exit — the account menu, the nav, the Settings page — lives
  // inside the shell, which meant someone in either state was stuck in the app
  // with nothing to tap. A removed teammate hit exactly that on a phone.
  const deadEnd = (title: string, body: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <Card className="w-full max-w-md p-8 text-center">
        <Logo className="w-12 h-12 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-ink mb-2">{title}</h1>
        <p className="text-sm text-muted">{body}</p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </Card>
    </div>
  )

  // A suspended organization is a commercial state, not a security boundary —
  // the data still belongs to the customer and an operator can lift it at any
  // time. So this blocks the app rather than the database: every dashboard route
  // renders through this layout, so there's no page to reach around it, and
  // re-enabling takes effect on the next request with nothing to clean up.
  // Deliberately NOT enforced in RLS, which would also cut off the exports and
  // final report a customer may still be owed.
  if (orgSuspended && !isSuperAdmin) {
    return deadEnd(
      'Account suspended',
      <>
        This organization&rsquo;s CrewTracker account is currently suspended. Your shows and
        payroll records are safe and untouched — please get in touch to restore access.
      </>,
    )
  }

  // No organization: either never invited into one, or removed from it. Handled
  // here rather than per page so it can't be reached around — the individual
  // pages had their own versions of this message with no way to sign out.
  // Deliberately doesn't distinguish "removed" from "never joined": the person
  // needs the same thing either way, and it isn't the app's place to announce it.
  if (user && !hasOrg && !isSuperAdmin) {
    return deadEnd(
      'Almost there',
      <>
        Your account isn&rsquo;t linked to an organization. If you were expecting an invite,
        check your email, or reach out to whoever invited you.
      </>,
    )
  }

  return (
    <AppShell
      canManageUsers={canManageUsers}
      isSuperAdmin={isSuperAdmin}
      userName={userName}
      userEmail={user?.email ?? undefined}
      organizations={organizations}
      version={APP_VERSION}
    >
      {children}
    </AppShell>
  )
}
