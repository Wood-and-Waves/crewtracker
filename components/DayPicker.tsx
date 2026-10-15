'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AnchoredPanel from '@/components/ui/AnchoredPanel'
import { dayActivitiesBgClass, dayLabel } from '@/lib/dayActivities'
import { cn } from '@/lib/cn'

// THE DATE ON THE TRACKER IS THE CONTROL (2026-10-15; Dan: "a clean way to
// have a date picker here. This way, I don't have to click through all the
// days to get to the beginning or the end"). Tap it and the show's days drop
// under it in a paper slip — one ruled row per day: its number, its date, and
// the day's tint square, the current day marked. The arrows either side stay
// for stepping; this is for jumping.
//
// A LIST, NOT A CALENDAR. A show has 2 to 20 days; a calendar would offer
// thirty of which four are real, which is a question with mostly wrong
// answers — and it is the control that was deliberately removed from this spot
// once (the day-type picker, which read as something to answer before punching
// anyone in). The first and last rows are the beginning and the end.
//
// NO WORDS FOR THE ACTIVITIES. "Show · Load-out · Travel" is the longest label
// the app produces and in a 300px row it crowded the date, which is the thing
// being picked (Dan, on the mockup: "the activities is too long sometimes").
// The tint square is the same colour the day header wears, so a green row is a
// show day whether or not it says so; the words ride on the row's title.
//
// Rows are ordinary links to `?day=N` — the same navigation as the arrows, so
// a prefetched day lands at once and a cold one shows the skeleton's absence
// honestly. Portalled through AnchoredPanel so the narrow header cannot clip
// it. Used by both tracker trees, so they cannot drift.

export type PickerDay = {
  dayNumber: number
  /** YYYY-MM-DD */
  date: string
  activities: string[] | null
  href: string
}

function shortDate(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export default function DayPicker({
  days, current, label, className,
}: {
  days: PickerDay[]
  current: number
  /** The date as the header already prints it; the trigger's text. */
  label: string
  /** The trigger's type treatment — each tree passes its own. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Open on the current day, so arrow keys start from where you are.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="date"]')
    el?.focus()
  }, [open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown'
      ? items[Math.min(items.length - 1, at + 1)]
      : items[Math.max(0, at - 1)]
    next?.focus()
    e.preventDefault()
  }

  return (
    <span ref={wrapRef} className="inline-flex">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Jump to a day"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-field px-1.5 -mx-1.5 hover:bg-surface-2',
          'focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent',
          className,
        )}
      >
        {label}
        <span className="text-[10px] font-normal text-muted">▾</span>
      </button>

      <AnchoredPanel
        anchorRef={wrapRef}
        open={open}
        onDismiss={() => setOpen(false)}
        role="menu"
        className="min-w-[14rem] border-2 border-ink bg-surface shadow-edge"
      >
        <div ref={listRef} onKeyDown={onKeyDown}>
          {days.map(d => {
            const isCurrent = d.dayNumber === current
            return (
              <Link
                key={d.dayNumber}
                role="menuitem"
                prefetch={false}
                href={d.href}
                aria-current={isCurrent ? 'date' : undefined}
                title={dayLabel(d.activities) ?? undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 border-b border-line px-3 py-2.5 text-sm text-ink last:border-b-0',
                  'hover:bg-surface-2 focus:outline-none focus:bg-surface-2',
                  isCurrent && 'border-l-[3px] border-l-accent bg-surface-2 pl-[9px] font-bold',
                )}
              >
                <span className={cn('h-2.5 w-2.5 shrink-0', dayActivitiesBgClass(d.activities) ?? 'bg-line')} />
                <span className="w-11 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Day {d.dayNumber}
                </span>
                <span className="tabular-nums">{shortDate(d.date)}</span>
              </Link>
            )
          })}
        </div>
      </AnchoredPanel>
    </span>
  )
}
