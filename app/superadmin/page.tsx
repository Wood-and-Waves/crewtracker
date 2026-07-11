import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const SUPER_ADMIN_ID = '28d3ae69-15bb-42bc-a478-5d9b43b737de'

export default async function SuperAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.id !== SUPER_ADMIN_ID) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()

  const { data: orgs } = await admin
    .from('organizations')
    .select('*, subscriptions(*)')
    .order('created_at', { ascending: false })

  const { data: users } = await admin
    .from('profiles')
    .select('*, organizations(name)')
    .order('created_at', { ascending: false })

  const { data: invites } = await admin
    .from('invitations')
    .select('*, organizations(name)')
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Super Admin</h1>
        <p className="text-zinc-400 mb-10">CrewTracker platform management</p>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Organizations ({orgs?.length ?? 0})</h2>
            
              <a href="/superadmin/invite-org" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 transition">New Org Invite</a>
          </div>
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="text-left px-4 py-3">Organization</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Trial Ends</th>
                  <th className="text-left px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {orgs?.map(org => (
                  <tr key={org.id} className="hover:bg-zinc-900">
                    <td className="px-4 py-3 font-medium">{org.name}</td>
                    <td className="px-4 py-3 capitalize">{org.subscriptions?.plan ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${org.subscriptions?.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                        {org.subscriptions?.status ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {org.subscriptions?.trial_ends_at ? new Date(org.subscriptions.trial_ends_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {new Date(org.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Users ({users?.length ?? 0})</h2>
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Organization</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {users?.map(u => (
                  <tr key={u.id} className="hover:bg-zinc-900">
                    <td className="px-4 py-3 font-medium">{u.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{u.email}</td>
                    <td className="px-4 py-3">{u.organizations?.name ?? '—'}</td>
                    <td className="px-4 py-3 capitalize">{u.base_role}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">
            Pending Invitations ({invites?.filter(i => !i.accepted_at).length ?? 0})
          </h2>
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Organization</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {invites?.map(invite => (
                  <tr key={invite.id} className="hover:bg-zinc-900">
                    <td className="px-4 py-3">{invite.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      {invite.is_new_organization ? invite.organization_name : invite.organizations?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${invite.is_new_organization ? 'bg-purple-900 text-purple-300' : 'bg-blue-900 text-blue-300'}`}>
                        {invite.is_new_organization ? 'New Org' : 'Team Member'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {new Date(invite.expires_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${invite.accepted_at ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
                        {invite.accepted_at ? 'Accepted' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}