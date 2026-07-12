'use client'

import { useState } from 'react'

export default function InviteOrgPage() {
  const [orgName, setOrgName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [error, setError] = useState('')

  async function createInvite() {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/admin/create-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgName, email: email || null }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
      } else {
        setInviteLink(`${window.location.origin}/invite/${data.token}`)
      }
    } catch (err) {
      setError('Network error — please try again')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-lg mx-auto">
        <a href="/superadmin" className="text-zinc-500 text-sm hover:text-zinc-300 mb-8 block">← Back to Super Admin</a>
        <h1 className="text-2xl font-bold mb-2">Invite New Organization</h1>
        <p className="text-zinc-400 mb-8">Generate an invite link for a new company to join CrewTracker.</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Organization Name</label>
            <input
              type="text"
              placeholder="Acme Productions LLC"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Email (optional)</label>
            <input
              type="email"
              placeholder="admin@acmeproductions.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-zinc-500 mt-1">If provided, only this email can use the invite link.</p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={createInvite}
            disabled={loading || !orgName}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Generate Invite Link'}
          </button>
        </div>

        {inviteLink && (
          <div className="mt-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
            <p className="text-sm text-zinc-400 mb-3">Invite link generated — share this with the new org admin:</p>
            <div className="flex items-center gap-3">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 rounded-lg bg-zinc-800 px-4 py-3 text-sm text-white outline-none"
              />
              <button
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="rounded-lg bg-zinc-700 px-4 py-3 text-sm font-medium hover:bg-zinc-600 transition"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-3">This link expires in 7 days.</p>
          </div>
        )}
      </div>
    </div>
  )
}
