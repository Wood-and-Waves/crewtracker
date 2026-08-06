'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'
import Select from '@/components/ui/Select'

// Approving the crew call and handing the show to a scheduler.
//
// The gate exists because the scheduler must not start filling positions while
// the call is still being edited — they would crew against a moving target and
// redo the work. Approval is per SHOW: the positions are per room per day, but
// this is one human decision.
//
// Nothing here blocks staffing in the database. The finalized-show lock is a
// trigger because it protects payroll; this is workflow sequencing, and in a
// small company the same person is often both admin and scheduler, so a gate
// that can strand somebody would be worse than the problem.

type Member = { id: string; name: string; email: string | null }

export default function HandoffToSchedulerButton({
  showId,
  approvedAt,
  schedulerName,
  positionCount,
  callSize,
  compact = false,
}: {
  showId: string
  approvedAt: string | null
  schedulerName: string | null
  /** Position ROWS across the whole show. Zero means nothing to hand over. */
  positionCount: number
  /** Human phrasing, e.g. "12 crew across 5 days" — what the scheduler reads. */
  callSize: string
  /** Inline in a horizontal toolbar rather than stacked in a sidebar. */
  compact?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [schedulerId, setSchedulerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    supabase
      .from('memberships')
      .select('profile_id, profiles(full_name, email)')
      .is('deactivated_at', null)
      .then(({ data }) => {
        if (!active) return
        const rows = (data ?? []).map((m: any) => {
          const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
          return {
            id: m.profile_id,
            name: p?.full_name || p?.email || 'Unnamed',
            email: p?.email ?? null,
          }
        })
        setMembers(rows.sort((a, b) => a.name.localeCompare(b.name)))
      })
    return () => { active = false }
  }, [open])

  async function approve() {
    if (!schedulerId || busy) return
    setBusy(true)
    setError('')
    setWarning('')

    const res = await fetch('/api/shows/approve-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, schedulerId }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(body.error || 'Could not hand off this show.')
      return
    }
    if (body.warning) {
      // The handoff happened; only the notification didn't. Say so rather than
      // showing a bare success and leaving them to wonder.
      setWarning(body.warning)
      router.refresh()
      return
    }
    setOpen(false)
    router.refresh()
  }

  if (approvedAt) {
    if (compact) {
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Chip tone="good">Handed off</Chip>
          <span className="max-w-[120px] truncate">{schedulerName || 'A scheduler'}</span>
        </span>
      )
    }
    return (
      <div className="border-2 border-ink bg-surface px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Crewing</span>
          <Chip tone="good">Handed off</Chip>
        </div>
        <p className="mt-1 truncate text-sm text-ink">{schedulerName || 'A scheduler'}</p>
      </div>
    )
  }

  const nothingToHandOff = positionCount === 0

  return (
    <>
      <Button
        variant="ghost"
        size={compact ? 'sm' : 'md'}
        className={compact ? '' : 'w-full'}
        onClick={() => setOpen(true)}
        disabled={nothingToHandOff}
        title={nothingToHandOff
          ? 'Add positions first — there is nothing to hand over yet.'
          : undefined}
      >
        Hand off to scheduler
      </Button>
      {nothingToHandOff && !compact && (
        <p className="mt-1 text-center text-[11px] text-muted">
          Add positions first
        </p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-card border border-line bg-surface p-5 sm:rounded-card">
            <h2 className="text-lg font-bold text-ink">Hand off to scheduler</h2>
            <p className="mb-4 mt-1 text-xs text-muted">
              This approves the positions — {callSize} — and emails them that
              it&rsquo;s ready to staff.
            </p>

            <Select
              ariaLabel="Scheduler"
              size="sm"
              value={schedulerId}
              onChange={setSchedulerId}
              options={[
                { value: '', label: 'Choose a scheduler…' },
                ...members.map(m => ({ value: m.id, label: `${m.name}${m.email ? '' : ' (no email)'}` })),
              ]}
            />

            {error && <p className="mt-3 text-xs text-danger">{error}</p>}
            {warning && <p className="mt-3 text-xs text-ot">{warning}</p>}

            <div className="mt-4 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
                {warning ? 'Close' : 'Cancel'}
              </Button>
              <Button className="flex-1" onClick={approve} disabled={!schedulerId || busy}>
                {busy ? 'Handing off…' : 'Approve & send'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
