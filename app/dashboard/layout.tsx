import AppShell from '@/components/AppShell'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let canManageUsers = false
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('can_manage_users')
      .eq('id', user.id)
      .single()
    canManageUsers = profile?.can_manage_users ?? false
  }

  return <AppShell canManageUsers={canManageUsers}>{children}</AppShell>
}
