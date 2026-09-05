'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PUNCH_ORDER, PUNCH_LABELS, nextPunchType, isWrapped, formatPunchTime, Punch, PunchType } from '@/lib/punches'
import { straightTimeHours, overtimeHours, doubleTimeHours, calculateNetHours, PayrollRuleset, TimecardLike } from '@/lib/payroll'
import TimeEntryModal from '@/components/TimeEntryModal'
import { cn } from '@/lib/cn'
import { punchGridCols } from '@/lib/trackerLayout'

const LOCKED_NOTE = 'Times are locked — the final report has been sent. An admin can unlock the show.'

export default function TimecardRow({
  timecard,
  punches,
  timezone,
  ruleset,
  allTimecards,
  dayDate,
  use24Hour = false,
  roundingMinutes = 1,
  visibleTypes,
  authorId,
  locked = false,
}: {
  timecard: { id: string; crew_member_id: string | null; crew_member_name: string; role: string; day_rate: number; is_travel_day: boolean; travel_in_day: boolean; travel_out_day: boolean; pay_as_half_day: boolean }
  punches: Punch[]
  timezone: string
  ruleset: PayrollRuleset
  allTimecards: TimecardLike[]
  dayDate: string
  use24Hour?: boolean
  /** Show is finalized: the database refuses punch and timecard writes. */
  locked?: boolean
  roundingMinutes?: number
  /** Punch columns to render, computed once for the whole day so every row and
   *  every room lines up under the same header. */
  visibleTypes: PunchType[]
  /** The signed-in PM. Recorded as the author of whatever this writes. */
  authorId: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [editingType, setEditingType] = useState<PunchType | null>(null)
  const [rowError, setRowError] = useState('')
  const [busy, setBusy] = useState(false)

  const next = nextPunchType(punches)
  const wrapped = isWrapped(punches)

  const timecardInput: TimecardLike = {
    id: timecard.id,
    crew_member_id: timecard.crew_member_id,
    day_rate: timecard.day_rate,
    is_travel_day: timecard.is_travel_day,
    travel_in_day: timecard.travel_in_day,
    travel_out_day: timecard.travel_out_day,
    pay_as_half_day: timecard.pay_as_half_day,
    punches,
  }

  const st = wrapped ? straightTimeHours(timecardInput, allTimecards, ruleset, roundingMinutes) : 0
  const ot = wrapped ? overtimeHours(timecardInput, allTimecards, ruleset, roundingMinutes) : 0
  const dt = wrapped ? doubleTimeHours(timecardInput, allTimecards, ruleset, roundingMinutes) : 0

  // Pay as Half Day is only offered on a completed work day of 5 net hours or
  // less — a negotiated call the PM makes on site. Days over 5 hours always get
  // the full day-rate guarantee, and payroll ignores the flag if it's somehow
  // left on, so the toggle simply disappears.
  const started = punches.some(p => p.punch_type === 'start')
  const showHalfDay =
    !timecard.is_travel_day &&
    started &&
    wrapped &&
    calculateNetHours(timecardInput, ruleset, roundingMinutes) <= 5

  // Anything to clear? Drives whether the reset control is offered at all.
  const hasAnything =
    punches.length > 0 ||
    timecard.is_travel_day ||
    timecard.travel_in_day ||
    timecard.travel_out_day ||
    timecard.pay_as_half_day

  async function toggleFlag(field: 'travel_in_day' | 'travel_out_day' | 'pay_as_half_day') {
    setRowError('')
    const { error } = await supabase
      .from('timecards')
      .update({ [field]: !timecard[field] })
      .eq('id', timecard.id)
    if (error) {
      setRowError(error.message)
      return
    }
    router.refresh()
  }

  // Wipes this person's day: all six punches plus the travel and half-day
  // flags — the same set iOS's resetPunches clears.
  async function resetRow() {
    const n = punches.length
    const punchPart = n > 0 ? `${n} punch${n === 1 ? '' : 'es'}` : 'no punches'
    if (!confirm(
      `Reset ${timecard.crew_member_name}'s day?\n\n` +
      `Deletes ${punchPart} and clears the travel and half-day flags. This can't be undone.`
    )) return

    setBusy(true)
    setRowError('')

    if (n > 0) {
      const { error } = await supabase.from('punches').delete().eq('timecard_id', timecard.id)
      if (error) {
        setBusy(false)
        setRowError(error.message)
        return
      }
    }

    const { error } = await supabase
      .from('timecards')
      .update({
        is_travel_day: false,
        travel_in_day: false,
        travel_out_day: false,
        pay_as_half_day: false,
      })
      .eq('id', timecard.id)

    setBusy(false)
    if (error) {
      setRowError(error.message)
      return
    }
    router.refresh()
  }

  // Derived from PUNCH_ORDER so a new meal needs no case here: a punch is
  // available once the one before it in the sequence exists.
  function isDisabled(type: PunchType): boolean {
    if (punches.find(p => p.punch_type === type)) return false
    if (type === 'start') return false
    if (type === 'end') return !punches.find(p => p.punch_type === 'start')
    const previous = PUNCH_ORDER[PUNCH_ORDER.indexOf(type) - 1]
    return !punches.find(p => p.punch_type === previous)
  }

  function PunchCell({ type }: { type: PunchType }) {
    const done = punches.find(p => p.punch_type === type)
    // Locked wins over chronology: a finalized show refuses every punch write,
    // so offering a live-looking button that fails is worse than showing it off.
    const disabled = locked || isDisabled(type)
    // ONE solid key per row — the guided next step. Wrap is usually also legal
    // the moment a shift starts, but two solid keys is a fork, not guidance:
    // the true next gets the solid accent, any other legal punch waits in the
    // ghost register.
    const isNext = !done && !disabled && type === next
    const isAvailable = !done && !disabled && type !== next
    return (
      <button
        onClick={() => setEditingType(type)}
        disabled={disabled}
        title={locked ? LOCKED_NOTE : undefined}
        className={cn(
          'rounded-field h-12 px-2 py-1 font-medium transition-colors text-center tabular-nums whitespace-nowrap',
          'flex flex-col items-center justify-center gap-0.5 lg:gap-0',
          // Mobile keeps every punch as a filled button — Dan rejected
          // collapsing them, and a thumb needs the target. Desktop drops the
          // chrome: a done punch is just its stamped time, and only the NEXT
          // action stays a button, which is what puts a crew member on one line.
          'lg:h-auto lg:px-2 lg:py-1.5',
          done && 'bg-surface-2 text-ink hover:opacity-90 lg:bg-transparent lg:text-ink lg:hover:bg-surface-2',
          // The lit next key — the Showbill tracker principle: the operator is
          // guided to the next right step. One solid Crew Blue key per row;
          // done steps stamp quiet, later steps recede. (An earlier accent
          // solid was rejected in the enclosure era for shouting inside a boxed
          // row — on open paper the row is quiet ink and the key IS the point.)
          isNext && 'bg-accent text-accent-ink font-bold hover:opacity-90',
          isAvailable && 'border-2 border-accent/45 bg-transparent text-accent font-semibold hover:border-accent',
          disabled && 'bg-surface-3 text-muted cursor-not-allowed lg:bg-transparent',
        )}
      >
        {done ? (
          <>
            <span className="lg:hidden block text-[10px] uppercase tracking-wide text-muted leading-none">
              {PUNCH_LABELS[type]}
            </span>
            {/* Crew-entered times wear a dotted underline — deliberately the
                quietest mark available. It has to say "somebody else typed
                this" without reading as an error or as a button, because on a
                show where everyone self-punches it would otherwise be on every
                cell of every row. The tooltip carries the meaning. */}
            <span
              title={done.source === 'crew' ? 'Entered by the crew member' : undefined}
              className={cn(
                'block font-mono text-xl leading-none font-bold lg:text-xs lg:font-medium lg:leading-normal',
                done.source === 'crew' && 'border-b border-dotted border-muted',
              )}
            >
              {formatPunchTime(done.punched_at, timezone, use24Hour)}
            </span>
          </>
        ) : (
          <>
            <span className="block text-lg leading-none font-bold uppercase lg:hidden">
              {PUNCH_LABELS[type]}
            </span>
            {/* An em dash rather than a greyed label: a punch that cannot be
                taken yet is not an offer, and six dim labels read as six
                broken buttons. */}
            <span className={cn(
              'hidden lg:block text-xs leading-normal',
              isNext ? 'font-bold uppercase' : isAvailable ? 'font-semibold uppercase' : 'font-medium',
            )}>
              {disabled ? '—' : PUNCH_LABELS[type]}
            </span>
          </>
        )}
      </button>
    )
  }

  return (
    <div className="border-b border-line last:border-b-0">
      <div className={cn('p-4 grid grid-cols-3 gap-2', punchGridCols(visibleTypes.length), 'lg:items-center lg:gap-3 lg:py-3')}>
        {/* Who + totals + undo */}
        <div className="col-span-3 lg:col-span-1 mb-2 lg:mb-0">
          {/* Mobile: name and role on one line, iOS-style */}
          <p className="lg:hidden text-base font-semibold text-ink">
            {timecard.crew_member_name}
            {timecard.role && <span className="font-normal text-muted"> | {timecard.role}</span>}
          </p>
          {/* Desktop: stacked to fit the narrow crew column */}
          <p className="hidden lg:block text-sm font-semibold text-ink">{timecard.crew_member_name}</p>
          <p className="hidden lg:block text-xs text-muted">{timecard.role}</p>
        </div>

        {timecard.is_travel_day ? (
          // Spans exactly the punch columns this room is showing. Literal class
          // names so Tailwind generates them.
          <div className={cn(
            'col-span-3 rounded-field bg-accent/10 text-accent text-center py-3 text-sm font-semibold',
            visibleTypes.length === 7 ? 'lg:col-span-7'
              : visibleTypes.length === 8 ? 'lg:col-span-8'
              : 'lg:col-span-6',
          )}>
            ✈ Travel Day
          </div>
        ) : (
          visibleTypes.map(type => <PunchCell key={type} type={type} />)
        )}

        {/* Travel, desktop only — the pill row below still serves mobile. */}
        <div className="hidden lg:flex items-center justify-center gap-1">
          {(['travel_in_day', 'travel_out_day'] as const).map(flag => (
            <button
              key={flag}
              onClick={() => toggleFlag(flag)}
              disabled={locked}
              title={locked ? LOCKED_NOTE : flag === 'travel_in_day' ? 'Travel in' : 'Travel out'}
              className={cn(
                'rounded-pill border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40',
                timecard[flag]
                  ? 'border-accent text-accent'
                  : 'border-line text-muted hover:text-ink',
              )}
            >
              {flag === 'travel_in_day' ? 'in' : 'out'}
            </button>
          ))}
        </div>

        <div className="col-span-3 lg:col-span-1 flex items-center justify-end lg:flex-col lg:items-end mt-2 lg:mt-0 gap-2 lg:gap-0.5">
          {wrapped && (
            <p className="text-sm font-bold text-ink tabular-nums">
              {st.toFixed(2)} ST
              {ot > 0 && <span className="block text-xs font-semibold text-ot">+{ot.toFixed(2)} OT</span>}
              {dt > 0 && <span className="block text-xs font-semibold text-ot">{dt.toFixed(2)} DT</span>}
            </p>
          )}
        </div>

        {/* Reset, desktop only. Rare and destructive, so it sits at the end of
            the row rather than taking a line of its own. */}
        <div className="hidden lg:flex items-center justify-end">
          {hasAnything && (
            <button
              onClick={resetRow}
              disabled={busy || locked}
              title={locked ? LOCKED_NOTE : `Reset ${timecard.crew_member_name}'s day — clears all punches and flags`}
              aria-label={`Reset ${timecard.crew_member_name}'s day`}
              className="rounded-pill px-1 text-sm text-muted transition-colors hover:text-danger disabled:opacity-40"
            >
              ↺
            </button>
          )}
        </div>
      </div>

      <div className={cn('flex flex-wrap gap-1.5 px-4 pb-3', showHalfDay ? '' : 'lg:hidden')}>
        <button
          onClick={() => toggleFlag('travel_in_day')}
          disabled={locked}
          title={locked ? LOCKED_NOTE : undefined}
          className={cn(
            'lg:hidden rounded-pill px-3 py-1 text-xs transition-colors',
            timecard.travel_in_day ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted',
          )}
        >
          ✈ Travel In
        </button>
        <button
          onClick={() => toggleFlag('travel_out_day')}
          disabled={locked}
          title={locked ? LOCKED_NOTE : undefined}
          className={cn(
            'lg:hidden rounded-pill px-3 py-1 text-xs transition-colors',
            timecard.travel_out_day ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted',
          )}
        >
          ✈ Travel Out
        </button>
        {showHalfDay && (
          <button
            onClick={() => toggleFlag('pay_as_half_day')}
            disabled={locked}
            title={locked ? LOCKED_NOTE : 'Pay this day at half the day rate (offered only at 5 net hours or less)'}
            className={cn(
              'rounded-pill px-3 py-1 text-xs transition-colors',
              timecard.pay_as_half_day ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted',
            )}
          >
            ◑ Half Day
          </button>
        )}
        {hasAnything && (
          <button
            onClick={resetRow}
            disabled={busy || locked}
            title={locked ? LOCKED_NOTE : `Reset ${timecard.crew_member_name}'s day — clears all punches and flags`}
            aria-label={`Reset ${timecard.crew_member_name}'s day`}
            className="lg:hidden ml-auto rounded-pill px-3 py-1 text-xs text-muted transition-colors hover:text-danger disabled:opacity-40"
          >
            ↺ Reset
          </button>
        )}
      </div>

      {rowError && <p className="px-4 pb-3 text-xs text-danger">{rowError}</p>}

      {editingType && (
        <TimeEntryModal
          timecardId={timecard.id}
          type={editingType}
          existingTime={punches.find(p => p.punch_type === editingType)?.punched_at || null}
          allPunches={punches}
          timezone={timezone}
          showTravelToggle={editingType === 'start'}
          isTravelDay={timecard.is_travel_day}
          dayDate={dayDate}
          authorId={authorId}
          roundingMinutes={roundingMinutes}
          onClose={() => setEditingType(null)}
        />
      )}
    </div>
  )
}
