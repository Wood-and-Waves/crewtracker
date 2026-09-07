import Link from 'next/link'
import { RULE_MAJOR } from '@/lib/panel'
import { describeShowDates } from '@/lib/pmInviteEmail'
import { cn } from '@/lib/cn'
import type { QueueRow } from '@/lib/schedulingQueue'

// The queue at the top of the Schedule screen: sent shows that still need a
// scheduler's hands — open positions, replies waiting, or a flag to sort out.
// Server component; fetchSchedulingQueue already did the work, this just lays
// it out. The masthead above is the page's ONE band, so this header strip is
// LIGHT (bg-surface-2 closed by a 2px ink rule), matching ShowsListClient's
// desktop table header — never a second solid slab.

function sentAgo(sentAt: string): string {
  const days = Math.floor((Date.now() - Date.parse(sentAt)) / 86_400_000)
  return days <= 0 ? 'sent today' : `sent ${days} day${days === 1 ? '' : 's'} ago`
}

export default function NeedsSchedulingList({ rows }: { rows: QueueRow[] }) {
  if (rows.length === 0) return null

  return (
    <div className="mb-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b-2 border-ink bg-surface-2 px-4 py-2.5 md:px-5">
        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
          Needs scheduling
        </span>
        <span />
      </div>

      <div className={cn('divide-y divide-line', RULE_MAJOR)}>
        {rows.map(row => (
          <Link
            key={row.id}
            href={`/dashboard/shows/${row.id}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 md:px-5"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{row.name}</div>
              <div className="truncate text-xs text-muted">
                {[row.venue, describeShowDates(row.startDate, row.endDate)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink">
                {row.openSlots} open of {row.totalSlots}
                {row.waiting > 0 && <> · {row.waiting} waiting</>}
                {row.flags > 0 && <> · <span className="text-ot">{row.flags} to sort out</span></>}
              </div>
              <div className="text-[10.5px] text-muted">{sentAgo(row.sentAt)}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
