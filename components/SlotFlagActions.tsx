'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'
import { moveResetsAnswer } from '@/lib/scheduleBoard'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import type { SlotFlag } from '@/lib/scheduleBoard'

// One booked day that no longer fits its definition, and the three human
// answers to it (piece B's rule, unchanged): MOVE them to one of the
// definition's open days, KEEP the day anyway (the slot detaches from the
// definition and becomes a one-off), or RELEASE the booking. The app never
// decides this itself — THE ONE RULE is that it adds open slots freely and
// never removes a booked person.
//
// Extracted from PositionDefsSection so the Scheduling screen's cells and Edit
// Show's list are the same code. The caller owns the crew change notice: both
// hosts collect the people whose days moved and offer to tell them, once.

type OpenSlot = { id: string; room_id: string; date: string; room_name: string }

function fmt(date: string) {
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function SlotFlagActions({
  showId, flag, locked = false, onChanged, onDone,
}: {
  showId: string
  flag: SlotFlag
  locked?: boolean
  /** Their days just changed — offer to tell them. Only people with a crew id. */
  onChanged?: (person: { id: string; name: string }) => void
  /** The flag is settled; the host may close whatever revealed these actions. */
  onDone?: () => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)
  const [openSlots, setOpenSlots] = useState<OpenSlot[]>([])
  const [target, setTarget] = useState('')

  function changed() {
    if (flag.crew_member_id) onChanged?.({ id: flag.crew_member_id, name: flag.crew_member_name })
  }

  async function startMove() {
    setError(''); setMoving(true); setOpenSlots([]); setTarget('')
    if (!flag.position_def_id) return
    // The definition's slots on other days, minus the ones somebody holds.
    const [{ data: slots }, { data: held }] = await Promise.all([
      supabase.from('crew_call_positions')
        .select('id, room_id, rooms!inner ( name, work_days!inner ( date ) )')
        .eq('position_def_id', flag.position_def_id),
      supabase.from('timecards').select('call_position_id')
        .not('call_position_id', 'is', null).neq('booking_status', 'declined'),
    ])
    const taken = new Set((held ?? []).map((t: any) => t.call_position_id))
    const open = (slots ?? []).filter((s: any) => !taken.has(s.id)).map((s: any) => {
      const room = Array.isArray(s.rooms) ? s.rooms[0] : s.rooms
      const wd = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
      return { id: s.id, room_id: s.room_id, date: wd?.date ?? '', room_name: room?.name ?? '' }
    }).sort((a: OpenSlot, b: OpenSlot) => a.date.localeCompare(b.date))
    setOpenSlots(open)
    setTarget(open[0]?.id ?? '')
  }

  async function confirmMove() {
    const slot = openSlots.find(s => s.id === target)
    if (!slot) return
    setBusy(true); setError('')
    const { data, error: e } = await supabase.from('timecards')
      .update({ room_id: slot.room_id, call_position_id: slot.id }).eq('id', flag.timecard_id).select('id')
    if (e || !data?.length) { setBusy(false); setError(e?.message ?? 'That did not move.'); return }

    // A MOVE TO ANOTHER DAY UN-ASKS THEM. They answered about the day they
    // were on; nobody has asked about this one. Without this the grid shows
    // "Confirmed" against a date the person has never heard of, and the
    // fully-staffed email counts them.
    //
    // Only this day, not the whole show: their other days are still days they
    // agreed to. The change notice offered next is the re-ask, and answering it
    // confirms them show-wide the way every other answer does.
    //
    // Declined rows are left alone — moving one must not resurrect it — and so
    // are rows already unasked, which have nothing to reset.
    if (moveResetsAnswer(flag.date, slot.date)) {
      await supabase.from('timecards')
        .update({ booking_status: 'pencilled', booking_invited_at: null, booking_responded_at: null })
        .eq('id', flag.timecard_id)
        .in('booking_status', ['confirmed', 'invited'])
    }
    await logStaffingEvent(supabase, {
      showId, kind: 'moved', crewMemberId: flag.crew_member_id,
      crewMemberName: flag.crew_member_name, role: flag.role, days: compressDays([slot.date]),
    })
    changed()
    setMoving(false)
    await supabase.rpc('sync_position_slots', { p_show_id: showId })
    setBusy(false)
    onDone?.()
    router.refresh()
  }

  async function keep() {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.from('crew_call_positions')
      .update({ position_def_id: null }).eq('id', flag.slot_id).select('id')
    setBusy(false)
    if (e || !data?.length) { setError(e?.message ?? 'That did not save.'); return }
    onDone?.()
    router.refresh()
  }

  async function release() {
    if (!confirm(`Release ${flag.crew_member_name} from ${flag.role} on ${fmt(flag.date)}? Their booking that day is removed.`)) return
    setBusy(true); setError('')
    const { data, error: e } = await supabase.from('timecards').delete().eq('id', flag.timecard_id).select('id')
    if (e || !data?.length) { setBusy(false); setError(e?.message ?? 'That did not release.'); return }
    await logStaffingEvent(supabase, {
      showId, kind: 'released', crewMemberId: flag.crew_member_id,
      crewMemberName: flag.crew_member_name, role: flag.role, days: compressDays([flag.date]),
    })
    changed()
    await supabase.rpc('sync_position_slots', { p_show_id: showId })
    setBusy(false)
    onDone?.()
    router.refresh()
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="ghost" disabled={busy || locked || !flag.position_def_id} onClick={startMove}>Move</Button>
      <Button size="sm" variant="ghost" disabled={busy || locked} onClick={keep}>Keep</Button>
      <Button size="sm" variant="danger" disabled={busy || locked} onClick={release}>Release</Button>
      {moving && (
        <span className="flex w-full items-center gap-2 pl-1">
          {openSlots.length === 0 ? (
            <span className="text-xs text-muted">No open day for this position right now.</span>
          ) : (
            <>
              <Select ariaLabel="Move to" size="sm" value={target} onChange={setTarget}
                options={openSlots.map(s => ({ value: s.id, label: `${fmt(s.date)} · ${s.room_name}` }))} />
              <Button size="sm" disabled={busy} onClick={confirmMove}>Move here</Button>
            </>
          )}
          <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setMoving(false)}>Cancel</button>
        </span>
      )}
      {error && <span className="w-full text-xs text-danger">{error}</span>}
    </span>
  )
}
