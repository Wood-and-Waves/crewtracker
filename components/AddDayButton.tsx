'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

// Extends a show by one day, cloning the last day's rooms and optionally its
// crew. Extracted from EditShowClient so the tracker's day switcher and Edit
// Show share one implementation — iOS offers this in both places, with a
// three-way "Add Day & Copy Crew" / "Add Day (Empty)" / Cancel choice.

// endDate / workDays / rooms used to be props because the client worked out the
// next date and cloned the rooms itself. add_show_day() derives all of that from
// the show id, so passing them would only invite them to drift out of date.
export default function AddDayButton({
  showId,
  hasCrew,
  variant = 'button',
}: {
  showId: string
  /** Whether the last day has any crew — decides if copying is offered. */
  hasCrew: boolean
  /**
   * Trigger style. A plain string rather than a render prop: this component is
   * rendered from the server-side tracker page, and functions cannot cross the
   * server/client boundary — see CLAUDE.md on non-component values and the
   * client/server export rule.
   */
  variant?: 'button' | 'circle'
}) {
  const router = useRouter()
  const supabase = createClient()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function open() {
    setError('')
    if (hasCrew) setAsking(true)
    else addDay(false)
  }

  async function addDay(copyCrew: boolean) {
    setBusy(true)
    setError('')

    // One call, one transaction. This used to be four sequential writes —
    // extend end_date, insert the day, insert the rooms, insert the crew — so a
    // failure partway through left a half-built day, and retrying then collided
    // with the day already sitting there on that date. The function does the
    // whole thing or none of it; see scripts/sql/applied/add-show-day-function.sql.
    //
    // Date arithmetic lives in SQL now too: `date + 1` on a date column carries
    // no timezone, which is the safest possible version of a calculation this
    // project has got wrong before.
    const { error: rpcError } = await supabase.rpc('add_show_day', {
      p_show_id: showId,
      p_copy_crew: copyCrew,
    })

    setBusy(false)
    if (rpcError) { setError(rpcError.message); return }

    setAsking(false)
    router.refresh()
  }

  return (
    <>
      {variant === 'circle' ? (
        <button
          onClick={open}
          disabled={busy}
          aria-label="Add another day"
          title="Add another day to this show"
          className="rounded-field bg-accent text-accent-ink h-9 w-9 flex items-center justify-center shrink-0 text-lg leading-none disabled:opacity-50"
        >
          +
        </button>
      ) : (
        <Button variant="ghost" size="sm" onClick={open} disabled={busy}>
          {busy ? 'Adding…' : '+ Add Day'}
        </Button>
      )}

      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-1">Add Next Day?</h2>
            <p className="text-xs text-muted mb-5">
              The new day gets the same rooms. You can bring the crew roster across too.
            </p>
            {error && <p className="text-xs text-danger mb-3">{error}</p>}
            <div className="flex flex-col gap-2">
              <Button className="w-full py-3" onClick={() => addDay(true)} disabled={busy}>
                {busy ? 'Adding…' : 'Add Day & Copy Crew'}
              </Button>
              <Button variant="ghost" className="w-full py-3" onClick={() => addDay(false)} disabled={busy}>
                Add Day (Empty)
              </Button>
              <Button variant="ghost" className="w-full py-2" onClick={() => setAsking(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* No-crew path has no dialog, so surface any failure inline. */}
      {!asking && error && <p className="text-xs text-danger mt-1">{error}</p>}
    </>
  )
}
