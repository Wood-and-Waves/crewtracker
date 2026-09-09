'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import type { UntoldPerson } from '@/lib/crewNotices'

// "2 people's days have changed and they have not been told."
//
// The confirm bar that appears right after a change is a prompt, and it dies
// when the scheduler navigates away; this is the standing record of the same
// thing. Same shape as CrewChangeNotice — a 3px accent rule, not a dialog —
// because it is a suggestion, not something blocking the screen.
//
// TWO BUTTONS, and the second is the important one (Dan, 2026-09-09): if the
// only way to clear the count is to send an email, people send unwanted emails
// or learn to ignore the number, and a counter everyone ignores is worse than
// no counter. "Already told them" clears it without sending anything.

export default function CrewNoticesBar({ showId, people }: { showId: string; people: UntoldPerson[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  if (people.length === 0) return null

  async function post(markOnly: boolean) {
    setBusy(true)
    setError('')
    const res = await fetch('/api/crew/days-changed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, crewMemberIds: people.map(p => p.crewMemberId), markOnly }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(body.error || 'That did not work.'); return }
    setDone(markOnly
      ? 'Marked as told.'
      : `Told ${body.sent ?? 0} of ${people.length}.`)
    router.refresh()
  }

  const one = people.length === 1

  return (
    <div className="border-l-[3px] border-accent py-1 pl-3">
      <p className="text-sm text-ink">
        <strong>{people.length}</strong> {one ? "person's" : "people's"} days have changed and{' '}
        {one ? 'they have' : 'they have'} not been told.
      </p>
      <p className="mt-0.5 text-xs text-muted">{people.map(p => p.name).join(', ')}</p>
      {done ? (
        <p className="mt-1 text-xs text-muted">{done}</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => post(false)}>
            {busy ? 'Sending…' : 'Tell them'}
          </Button>
          <button
            type="button"
            className="text-xs text-muted underline hover:text-ink disabled:opacity-40"
            disabled={busy}
            onClick={() => post(true)}
          >
            Already told them
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
