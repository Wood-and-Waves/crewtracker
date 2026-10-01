'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import { summarizeAsk, type AskOutcome } from '@/lib/bookingEmail'

// Ask everyone still pencilled on a show, in one go (Dan, 2026-09-07: "Would
// be great to happen in a group rather than one at a time"). One booking
// request EMAIL per person covering all their days — the same
// /api/bookings/send the per-person Ask uses, called once per person, so the
// wording, the token and the expiry are identical however they were asked.
// Somebody with no email is reported, not skipped silently.

export default function AskPencilledButton({
  showId, size = 'sm', pencilled,
}: {
  showId: string
  size?: 'sm' | 'md'
  /**
   * How many people are still unasked, when the caller knows.
   *
   * THE GATE LIVES HERE RATHER THAN IN THE PARENT, and that is the whole point.
   * The Scheduling strip used to render this only while somebody was unasked —
   * so the moment the last one was asked the refresh unmounted the button and
   * took the result line with it, and Dan pressed Send and saw nothing at all.
   * Exactly the AddDayButton bug recorded in CLAUDE.md, where refreshing
   * removed the control that was still speaking. Holding the gate inside means
   * the button can disappear while the sentence it just wrote stays put.
   *
   * Undefined = the caller does not count (Edit Show), so always show it.
   */
  pencilled?: number
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function askAll() {
    if (busy) return
    setBusy(true); setNote('')
    // Pencilled = every live booking of theirs on this show is still
    // 'pencilled'. Somebody already asked (invited) or confirmed is left alone.
    const { data, error } = await supabase
      .from('timecards').select('crew_member_id, crew_member_name, booking_status')
      .eq('show_id', showId).neq('booking_status', 'declined').not('crew_member_id', 'is', null)
    if (error) { setBusy(false); setNote(error.message); return }
    const byPerson = new Map<string, { name: string; allPencilled: boolean }>()
    for (const t of (data ?? []) as any[]) {
      const p = byPerson.get(t.crew_member_id) ?? { name: t.crew_member_name, allPencilled: true }
      if (t.booking_status !== 'pencilled') p.allPencilled = false
      byPerson.set(t.crew_member_id, p)
    }
    const people = [...byPerson.entries()].filter(([, p]) => p.allPencilled)
    if (people.length === 0) { setBusy(false); setNote('Everyone has been asked or has answered.'); return }
    if (!confirm(`Email a booking request to the ${people.length} ${people.length === 1 ? 'person' : 'people'} who have not been asked yet?`)) { setBusy(false); return }

    // THE REASON IS THE USEFUL PART. This used to collect names and throw the
    // route's words away, so "Couldn't email: Bill, Noor, Bob" read the same
    // whether they had no addresses or the whole send was refused — see
    // summarizeAsk.
    const results: AskOutcome[] = []
    for (const [crewMemberId, p] of people) {
      const res = await fetch('/api/bookings/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showId, crewMemberId }),
      })
      const body = await res.json().catch(() => ({}))
      results.push({
        name: p.name,
        emailed: res.ok && !!body.emailed,
        reason: body.error ?? body.warning ?? null,
      })
    }
    setBusy(false)
    setNote(summarizeAsk(results))
    router.refresh()
  }

  // Nobody left to ask and nothing left to say: render nothing.
  if (pencilled === 0 && !note) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {pencilled !== 0 && (
        <Button size={size} variant="ghost" disabled={busy} onClick={askAll}>
          {busy ? 'Sending…' : 'Send email invites'}
        </Button>
      )}
      {note && <span className="text-xs text-muted">{note}</span>}
    </span>
  )
}
