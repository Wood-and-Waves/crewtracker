'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

// Ask everyone still pencilled on a show, in one go (Dan, 2026-09-07: "Would
// be great to happen in a group rather than one at a time"). One booking
// request EMAIL per person covering all their days — the same
// /api/bookings/send the per-person Ask uses, called once per person, so the
// wording, the token and the expiry are identical however they were asked.
// Somebody with no email is reported, not skipped silently.

export default function AskPencilledButton({ showId, size = 'sm' }: { showId: string; size?: 'sm' | 'md' }) {
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
    if (people.length === 0) { setBusy(false); setNote('Nobody is pencilled — everyone has been asked or has answered.'); return }
    if (!confirm(`Email a booking request to the ${people.length} ${people.length === 1 ? 'person' : 'people'} still pencilled on this show?`)) { setBusy(false); return }

    let sent = 0
    const failed: string[] = []
    for (const [crewMemberId, p] of people) {
      const res = await fetch('/api/bookings/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showId, crewMemberId }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.emailed) sent++
      else failed.push(p.name)
    }
    setBusy(false)
    setNote(`Asked ${sent} of ${people.length} by email.${failed.length ? ` Couldn't email: ${failed.join(', ')}.` : ''}`)
    router.refresh()
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size={size} variant="ghost" disabled={busy} onClick={askAll}>
        {busy ? 'Asking…' : 'Ask everyone pencilled'}
      </Button>
      {note && <span className="text-xs text-muted">{note}</span>}
    </span>
  )
}
