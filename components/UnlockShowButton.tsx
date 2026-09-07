'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

// Reopens a show whose Final Report has been sent. Clears finalized_at, which
// is what the block_writes_when_finalized trigger checks; the audit columns
// (finalized_by, final_report_recipients) are left intact so the record of the
// original sign-off survives.
//
// Admins and the show's PM (Section 5, 2026-09-06). The page shows it to
// PM-side people who may edit timecards; guard_show_unlock() (0031) is the
// rule at the database, so a hand-made request gets the same answer.

export default function UnlockShowButton({ showId }: { showId: string }) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function unlock() {
    if (!confirm(
      'Unlock this show?\n\nTimes become editable again. The record of the final report that was ' +
      'already sent is kept, so re-sending will need to happen deliberately.'
    )) return
    setBusy(true)
    setError('')
    const { error: e } = await supabase.from('shows').update({ finalized_at: null }).eq('id', showId)
    setBusy(false)
    if (e) { setError(e.message); return }
    router.refresh()
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={unlock} disabled={busy}>
        {busy ? 'Unlocking…' : 'Unlock show'}
      </Button>
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </>
  )
}
