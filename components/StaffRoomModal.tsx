'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/cn'
import Button from '@/components/ui/Button'

type CrewMember = { id: string; full_name: string }
type RateCard = { crew_member_id: string; role: string; day_rate: number }
type Sel = { role: string; dayRate: string; other: boolean }

const OTHER = '__other__'

const inputCls =
  'rounded-field bg-surface-2 border border-line px-3 py-2 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function StaffRoomModal({
  organizationId,
  roomId,
  roomName,
  currentWorkDayId,
  remainingRoomIdsSameName,
  dayAssignments = [],
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  canEditRates = false,
}: {
  organizationId: string
  roomId: string
  roomName: string
  currentWorkDayId: string
  remainingRoomIdsSameName: string[]
  dayAssignments?: { crewMemberId: string; roomId: string; roomName: string }[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  /** profiles.can_edit_pay_rates. Without it the rate field is hidden: the
   *  database drops any rate such a caller submits (see
   *  scripts/sql/enforce-pay-rate-writes.sql), so offering the field would be
   *  showing someone a control that silently does nothing. */
  canEditRates?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (v: boolean) => {
    onOpenChange?.(v)
    if (controlledOpen === undefined) setInternalOpen(v)
  }
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  // Rates already established on THIS show, keyed `crewMemberId|role`. A day
  // rate belongs to the show, so once one is set the database ignores whatever
  // an insert supplies (see scripts/sql/show-wide-day-rate.sql). Loading them
  // here keeps the form from advertising a directory rate that won't be used.
  const [showRates, setShowRates] = useState<Record<string, number>>({})
  const [roles, setRoles] = useState<string[]>([])
  // `other` puts the role field into free-text mode for a one-off title.
  const [selected, setSelected] = useState<Record<string, Sel>>({})
  const [applyAll, setApplyAll] = useState(true)
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Names of selected crew already staffed in OTHER rooms today, awaiting a
  // confirm before we also add them here.
  const [pendingCrossRoom, setPendingCrossRoom] = useState<string[] | null>(null)
  // Post-insert summary when some days were skipped as already-staffed.
  const [notice, setNotice] = useState('')

  function inThisRoom(memberId: string) {
    return dayAssignments.some(a => a.crewMemberId === memberId && a.roomId === roomId)
  }
  function otherRoomsFor(memberId: string) {
    return [...new Set(
      dayAssignments.filter(a => a.crewMemberId === memberId && a.roomId !== roomId).map(a => a.roomName)
    )]
  }

  useEffect(() => {
    if (!open) return
    async function load() {
      const { data: crewData } = await supabase
        .from('crew_members')
        .select('id, full_name')
        .eq('organization_id', organizationId)
        .order('full_name')
      setCrew(crewData || [])

      // Ordered so the pre-filled rate is deterministic. Unordered, `.find()`
      // returned an arbitrary card, so anyone holding a $0 placeholder rate
      // alongside a real one could silently be staffed at $0.
      // Via the permission-checked view, so someone without can_view_pay_rates
      // gets no saved-rate chips rather than a list of everyone's rates.
      const { data: rateData } = await supabase
        .from('crew_rate_cards_visible')
        .select('crew_member_id, role, day_rate')
        .order('role')
      setRateCards(rateData || [])

      // The org's curated job titles — the same list the directory and the
      // room's Edit Crew panel use. Staffing used to bypass it entirely with a
      // free-text field, so "A1", "a1" and "A-1" became distinct roles and
      // split one person into separate rows in By Crew.
      const { data: roleData } = await supabase
        .from('av_roles')
        .select('name')
        .eq('organization_id', organizationId)
        .order('sort_order')
      setRoles((roleData || []).map(r => r.name))

      // Every rate already in use anywhere on this show. Reached through
      // rooms -> work_days because timecards carry no show_id of their own.
      const { data: dayRow } = await supabase
        .from('work_days')
        .select('show_id')
        .eq('id', currentWorkDayId)
        .single()

      if (dayRow?.show_id) {
        // Two queries: the timecards give (crew, role) per timecard id, the view
        // gives the rate for the ids this user is allowed to see. Joined by id
        // rather than selecting day_rate off timecards directly, which is the
        // access the lockdown removes.
        const [{ data: existing }, { data: rates }] = await Promise.all([
          supabase
            .from('timecards')
            .select('id, crew_member_id, role, rooms!inner(work_days!inner(show_id))')
            .eq('rooms.work_days.show_id', dayRow.show_id)
            .not('crew_member_id', 'is', null),
          supabase
            .from('timecard_day_rates')
            .select('timecard_id, day_rate')
            .eq('show_id', dayRow.show_id),
        ])

        const rateById = new Map((rates || []).map(r => [r.timecard_id, Number(r.day_rate) || 0]))
        const map: Record<string, number> = {}
        for (const tc of existing || []) {
          const rate = rateById.get(tc.id)
          if (rate === undefined) continue
          map[`${tc.crew_member_id}|${tc.role ?? ''}`] = rate
        }
        setShowRates(map)
      }
    }
    load()
  }, [open, organizationId, currentWorkDayId])

  function cardsFor(id: string) {
    return rateCards.filter(rc => rc.crew_member_id === id)
  }

  /** The rate this person already holds in this role on this show, if any. */
  function showRateFor(id: string, role: string): number | null {
    const v = showRates[`${id}|${role}`]
    return v === undefined ? null : v
  }

  function toggleCrew(id: string) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[id]) {
        delete next[id]
      } else {
        const first = cardsFor(id)[0]
        const role = first?.role || ''
        // The show's own rate outranks the directory default.
        const onShow = showRateFor(id, role)
        next[id] = {
          role,
          dayRate: onShow !== null ? String(onShow) : (first ? String(first.day_rate) : ''),
          other: false,
        }
      }
      return next
    })
  }

  function updateField(id: string, field: 'role' | 'dayRate', value: string) {
    setSelected(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  function chooseRole(id: string, value: string) {
    setSelected(prev => {
      const cur = prev[id]
      if (value === OTHER) return { ...prev, [id]: { ...cur, other: true, role: '' } }
      // Picking a role the person has a saved rate for brings the rate with it —
      // unless this show already has a rate for that role, which wins.
      const onShow = showRateFor(id, value)
      const card = cardsFor(id).find(c => c.role === value)
      return {
        ...prev,
        [id]: {
          ...cur,
          other: false,
          role: value,
          dayRate: onShow !== null ? String(onShow)
            : card ? String(card.day_rate)
            : cur.dayRate,
        },
      }
    })
  }

  function applyCard(id: string, card: RateCard) {
    const onShow = showRateFor(id, card.role)
    setSelected(prev => ({
      ...prev,
      [id]: {
        role: card.role,
        dayRate: onShow !== null ? String(onShow) : String(card.day_rate),
        other: false,
      },
    }))
  }

  async function addCrewMember() {
    if (!newName.trim()) return
    const { data, error: insertError } = await supabase
      .from('crew_members')
      .insert({ organization_id: organizationId, full_name: newName.trim() })
      .select()
      .single()

    if (insertError || !data) {
      setError(insertError?.message || 'Failed to add crew member')
      return
    }

    setCrew(prev => [...prev, data].sort((a, b) => a.full_name.localeCompare(b.full_name)))
    setNewName('')
  }

  function submit() {
    setError('')
    setNotice('')
    const selectedIds = Object.keys(selected).filter(id => !inThisRoom(id))
    if (selectedIds.length === 0) {
      setError('Select at least one crew member')
      return
    }
    // If any selected crew are already in another room today, confirm first.
    const crossRoom = selectedIds
      .filter(id => otherRoomsFor(id).length > 0)
      .map(id => crew.find(c => c.id === id)?.full_name || 'Someone')
    if (crossRoom.length > 0) {
      setPendingCrossRoom(crossRoom)
      return
    }
    doInsert()
  }

  async function doInsert() {
    setPendingCrossRoom(null)
    setError('')
    setLoading(true)

    const roomIds = applyAll ? [roomId, ...remainingRoomIdsSameName] : [roomId]
    const crewIds = Object.keys(selected)

    // Ask the database who is ALREADY on these rosters, rather than trusting
    // `dayAssignments`. Those props only cover the ACTIVE day, so "apply to all
    // remaining days" had no guard at all on future days; and they go stale if
    // the page hasn't re-rendered since a previous insert. Both routes produced
    // duplicate timecards, which then feed batch punching and every report
    // total. A unique index on (room_id, crew_member_id) backs this up.
    const { data: existing, error: exError } = await supabase
      .from('timecards')
      .select('room_id, crew_member_id')
      .in('room_id', roomIds)
      .in('crew_member_id', crewIds)

    if (exError) {
      setError(exError.message)
      setLoading(false)
      return
    }

    const taken = new Set((existing || []).map(e => `${e.room_id}|${e.crew_member_id}`))

    const timecardRows: any[] = []
    const rateCardUpserts: any[] = []
    let skippedDays = 0
    const skippedNames = new Set<string>()

    for (const [crewId, info] of Object.entries(selected)) {
      const member = crew.find(c => c.id === crewId)
      if (!member) continue
      const dayRate = parseFloat(info.dayRate) || 0

      for (const rId of roomIds) {
        if (taken.has(`${rId}|${crewId}`)) {
          skippedDays++
          skippedNames.add(member.full_name)
          continue
        }
        timecardRows.push({
          room_id: rId,
          crew_member_id: crewId,
          crew_member_name: member.full_name,
          role: info.role,
          day_rate: dayRate,
        })
      }

      if (info.role) {
        rateCardUpserts.push({ crew_member_id: crewId, role: info.role, day_rate: dayRate })
      }
    }

    if (timecardRows.length === 0) {
      setError(
        skippedDays > 0
          ? `${[...skippedNames].join(', ')} ${skippedNames.size === 1 ? 'is' : 'are'} already on every day selected.`
          : 'Select at least one crew member'
      )
      setLoading(false)
      return
    }

    const { error: tcError } = await supabase.from('timecards').insert(timecardRows)
    if (tcError) {
      // 23505 = the unique index caught a duplicate the check above missed
      // (e.g. someone else staffed the same person concurrently).
      setError(
        tcError.code === '23505'
          ? 'Someone was already added to one of these days. Reopen and try again.'
          : tcError.message
      )
      setLoading(false)
      return
    }

    for (const rc of rateCardUpserts) {
      await supabase
        .from('rate_cards')
        .upsert(rc, { onConflict: 'crew_member_id,role' })
    }

    setLoading(false)
    setSelected({})
    router.refresh()

    // Don't close silently when days were skipped — the PM asked for N days and
    // got fewer, so say so rather than leaving them to notice on the roster.
    if (skippedDays > 0) {
      const added = timecardRows.length
      setNotice(
        `Added ${added} ${added === 1 ? 'day' : 'days'}. Skipped ${skippedDays} — ` +
        `${[...skippedNames].join(', ')} ${skippedNames.size === 1 ? 'was' : 'were'} already staffed there.`
      )
    } else {
      setOpen(false)
    }
  }

  if (!open) {
    if (hideTrigger) return null
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-field bg-accent-wash px-3 py-2 text-sm font-medium text-accent transition hover:opacity-80"
      >
        + Add Crew Member
      </button>
    )
  }

  const selectedCount = Object.keys(selected).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-card bg-surface border border-line shadow-xl">
        <div className="p-6 pb-4 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Staff {roomName}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pt-4">
          <div className="flex gap-2 mb-4">
            <input
              placeholder="Quick add crew member name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCrewMember()}
              className={`${inputCls} flex-1`}
            />
            <Button variant="ghost" size="sm" onClick={addCrewMember}>Add</Button>
          </div>

          <div className="flex flex-col gap-2">
            {crew.length === 0 && (
              <p className="text-sm text-muted">No crew members yet. Add one above.</p>
            )}
            {crew.map(member => {
              const isSelected = !!selected[member.id]
              const alreadyHere = inThisRoom(member.id)
              const elsewhere = otherRoomsFor(member.id)
              return (
                <div key={member.id} className="rounded-field bg-surface-2 p-3">
                  <label className={`flex items-center gap-3 ${alreadyHere ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={alreadyHere}
                      onChange={() => toggleCrew(member.id)}
                      className="h-4 w-4 rounded accent-accent"
                    />
                    <span className="text-sm text-ink">{member.full_name}</span>
                    {alreadyHere && <span className="ml-auto text-xs text-muted">Already in this room</span>}
                    {!alreadyHere && elsewhere.length > 0 && (
                      <span className="ml-auto text-xs text-ot">Also in {elsewhere.join(', ')}</span>
                    )}
                  </label>
                  {isSelected && !alreadyHere && (() => {
                    const sel = selected[member.id]
                    const cards = cardsFor(member.id)
                    // Keep a saved role that isn't in the org list selectable.
                    const roleOptions = [...new Set([
                      ...(sel.role && !sel.other ? [sel.role] : []),
                      ...roles,
                    ])]
                    // A rate already in force on this show for this role. Checked
                    // for custom roles too — the database matches on the role
                    // string either way, so a typed title that collides with an
                    // existing one is genuinely locked.
                    const lockedRate = showRateFor(member.id, sel.role)
                    return (
                      <div className="mt-2 pl-7 flex flex-col gap-2">
                        {cards.length > 1 && (
                          <div className="flex flex-wrap gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-muted self-center mr-1">Saved</span>
                            {cards.map(cd => {
                              const active = !sel.other && sel.role === cd.role && sel.dayRate === String(cd.day_rate)
                              return (
                                <button
                                  key={cd.role}
                                  onClick={() => applyCard(member.id, cd)}
                                  className={cn(
                                    'rounded-pill px-2 py-0.5 text-[11px] transition-colors',
                                    active ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted hover:text-ink',
                                  )}
                                >
                                  {cd.role} · ${Math.round(cd.day_rate)}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <select
                            key={roleOptions.join(',')}
                            value={sel.other ? OTHER : sel.role}
                            onChange={e => chooseRole(member.id, e.target.value)}
                            className={`${inputCls} flex-1 text-xs`}
                          >
                            {!sel.role && !sel.other && (
                              <option value="" className="bg-surface-2 text-ink">Select a role…</option>
                            )}
                            {roleOptions.map(r => (
                              <option key={r} value={r} className="bg-surface-2 text-ink">{r}</option>
                            ))}
                            <option value={OTHER} className="bg-surface-2 text-ink">Other…</option>
                          </select>
                          {/* Hidden entirely without can_edit_pay_rates — the
                              database drops any rate such a caller sends, so the
                              field would do nothing. Staffing still works; the
                              rate comes from the show via the inherit trigger. */}
                          {canEditRates && (
                            <input
                              placeholder="Day rate"
                              type="number"
                              value={sel.dayRate}
                              onChange={e => updateField(member.id, 'dayRate', e.target.value)}
                              // Locked once the show has a rate for this role: the
                              // database would override anything typed here, so
                              // offering the field would be a lie. Changing a show
                              // rate is a deliberate act, done in Edit Show or the
                              // room's Edit Crew panel.
                              readOnly={lockedRate !== null}
                              title={lockedRate !== null ? 'Set for this show' : undefined}
                              className={cn(
                                inputCls, 'w-24 text-xs',
                                lockedRate !== null && 'text-muted cursor-not-allowed',
                              )}
                            />
                          )}
                        </div>
                        {canEditRates && lockedRate !== null && (
                          <p className="text-[11px] text-muted">
                            ${Math.round(lockedRate)} is {member.full_name.split(' ')[0]}&rsquo;s rate for
                            this show{sel.role ? ` as ${sel.role}` : ''} — change it in Edit Show.
                          </p>
                        )}
                        {sel.other && (
                          <input
                            autoFocus
                            placeholder="Custom role title"
                            value={sel.role}
                            onChange={e => updateField(member.id, 'role', e.target.value)}
                            className={`${inputCls} text-xs`}
                          />
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        </div>

        <div className="p-6 pt-4 border-t border-line">
          {remainingRoomIdsSameName.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted mb-3">
              <input
                type="checkbox"
                checked={applyAll}
                onChange={e => setApplyAll(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              Apply to all remaining days for this room
            </label>
          )}
          {error && <p className="text-xs text-danger mb-3">{error}</p>}
          {notice && <p className="text-xs text-ot mb-3">{notice}</p>}
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1 py-3" onClick={() => setOpen(false)}>
              {notice ? 'Done' : 'Cancel'}
            </Button>
            <Button className="flex-1 py-3" onClick={submit} disabled={loading || selectedCount === 0}>
              {loading ? 'Staffing...' : `Staff ${selectedCount || ''} Crew`}
            </Button>
          </div>
        </div>

        {pendingCrossRoom && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-card bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
              <h3 className="text-lg font-bold text-ink mb-2">Already staffed elsewhere</h3>
              <p className="text-sm text-muted mb-5">
                {pendingCrossRoom.join(', ')} {pendingCrossRoom.length === 1 ? 'is' : 'are'} already in another room today. Add to {roomName} as well?
              </p>
              <div className="flex gap-3">
                <Button variant="ghost" className="flex-1 py-3" onClick={() => setPendingCrossRoom(null)}>Cancel</Button>
                <Button className="flex-1 py-3" onClick={doInsert} disabled={loading}>Add to {roomName}</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
