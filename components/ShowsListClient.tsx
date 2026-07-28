'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Chip from '@/components/ui/Chip'
import ArchiveShowButton from '@/components/ArchiveShowButton'
import { cn } from '@/lib/cn'
import type { ShowStatus } from '@/lib/showStatus'

// The shows list as a table rather than a wall of cards.
//
// Cards gave each show an enormous amount of vertical space to say four things,
// so ten shows did not fit on a screen and none of them could be compared. A
// production company runs dozens a year; the list is something you SCAN.
//
// Follows the house table pattern from CrewDirectoryClient: a real ruled table
// on desktop, the same rows restacked below 1024px. Not a shrunken table —
// column headers disappear entirely on mobile, because a five-column grid at
// 375px is unreadable however hard it is squeezed.
//
// Search and sort are client-side. The page already loads every show for the
// organization to count the archived ones, so filtering here costs nothing and
// avoids a round trip per keystroke.

export type ShowRow = {
  id: string
  name: string
  venue: string | null
  cityState: string | null
  clientCompany: string | null
  startDate: string
  endDate: string
  dayCount: number
  status: ShowStatus
  statusLabel: string
  statusTone: 'neutral' | 'live' | 'ot' | 'good' | 'danger' | 'staffing' | 'preshow' | 'archived'
  /** Headcount on the busiest day — how many people must be found. */
  peakPerDay: number
  /** Position rows filled and total. Exact, but not what the column leads with. */
  filled: number
  total: number
  schedulerName: string | null
  archived: boolean
}

type SortKey = 'dates' | 'name' | 'status' | 'crewed'

// Lifecycle order, so sorting by status walks a show's life rather than the
// alphabet. Matches the order in SHOW_STATUS_META.
const STATUS_RANK: Record<ShowStatus, number> = {
  new: 0, staffing: 1, preshow: 2, active: 3, wrapped: 4, finalized: 5, archived: 6,
}

const COLS = 'grid-cols-[minmax(0,1.8fr)_116px_104px_112px_104px_84px]'

function fmtRange(start: string, end: string) {
  // Bare 'YYYY-MM-DD' + T00:00:00 = local midnight. A date-only string parses as
  // UTC and renders as the previous day west of Greenwich.
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const a = new Date(start + 'T00:00:00').toLocaleDateString('en-US', opts)
  const b = new Date(end + 'T00:00:00').toLocaleDateString('en-US', opts)
  return start === end ? a : `${a} – ${b}`
}

function Crewed({ row }: { row: ShowRow }) {
  if (row.total === 0) {
    return <span className="text-xs text-muted">No call yet</span>
  }
  const pct = Math.round((row.filled / row.total) * 100)
  return (
    // Percentage, not "35 / 60". Positions are stored per room per day, so a
    // 12-person show over 5 days has 60 rows — a number nobody crews against,
    // and the reason the handoff email was rewritten. The headcount underneath
    // says how big the show is; the exact shift counts live in the tooltip.
    <div title={`${row.filled} of ${row.total} shifts filled · ${row.peakPerDay} crew a day`}>
      <div className="text-xs font-semibold text-ink">{pct}%</div>
      <div className="mt-1 h-1 w-full rounded-pill bg-surface-2">
        <div
          className={cn('h-1 rounded-pill', pct === 100 ? 'bg-good' : 'bg-accent')}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <div className="mt-0.5 text-[10.5px] text-muted">{row.peakPerDay} a day</div>
    </div>
  )
}

export default function ShowsListClient({
  rows,
  canArchive,
}: {
  rows: ShowRow[]
  canArchive: boolean
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('dates')
  const [asc, setAsc] = useState(false)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? rows.filter(r =>
          [r.name, r.venue, r.cityState, r.clientCompany, r.schedulerName]
            .some(v => v?.toLowerCase().includes(q)),
        )
      : rows

    const dir = asc ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'name': return dir * a.name.localeCompare(b.name)
        case 'status': return dir * (STATUS_RANK[a.status] - STATUS_RANK[b.status])
        case 'crewed': {
          // A show with no call sorts as least-crewed rather than as 100%,
          // which is what dividing by zero would otherwise imply.
          const pa = a.total === 0 ? -1 : a.filled / a.total
          const pb = b.total === 0 ? -1 : b.filled / b.total
          return dir * (pa - pb)
        }
        default: return dir * a.startDate.localeCompare(b.startDate)
      }
    })
  }, [rows, query, sort, asc])

  function header(key: SortKey, label: string, className?: string) {
    const active = sort === key
    return (
      <button
        onClick={() => {
          if (active) setAsc(v => !v)
          else { setSort(key); setAsc(key === 'name') }
        }}
        className={cn(
          'flex items-center gap-1 text-left text-[10.5px] font-bold uppercase tracking-wide transition-colors',
          active ? 'text-ink' : 'text-muted hover:text-ink',
          className,
        )}
      >
        {label}
        {active && <span aria-hidden="true">{asc ? '↑' : '↓'}</span>}
      </button>
    )
  }

  return (
    <>
      <div className="mb-4">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search shows, venues, clients…"
          className="w-full rounded-field border border-line bg-surface-2 px-4 py-2.5 text-sm text-ink placeholder:text-muted outline-none focus:border-accent md:max-w-sm"
        />
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {query ? `Nothing matches “${query}”.` : 'No shows here yet.'}
        </p>
      ) : (
        <>
          {/* Desktop: a real ruled table */}
          <div className="hidden overflow-hidden rounded-card border border-line bg-surface lg:block">
            <div className={cn('grid gap-3 border-b border-line px-5 py-2.5', COLS)}>
              {header('name', 'Show')}
              {header('dates', 'Dates')}
              {header('status', 'Status')}
              {header('crewed', 'Crewed')}
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">Scheduler</span>
              <span />
            </div>

            {shown.map(row => (
              <div
                key={row.id}
                className={cn(
                  'group grid items-center gap-3 border-b border-line px-5 py-3 transition-colors last:border-b-0 hover:bg-surface-2',
                  COLS,
                )}
              >
                <Link href={`/dashboard/shows/${row.id}`} className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{row.name}</div>
                  <div className="truncate text-xs text-muted">
                    {[row.venue, row.cityState].filter(Boolean).join(' · ') || '—'}
                  </div>
                </Link>

                <Link href={`/dashboard/shows/${row.id}`}>
                  <div className="text-xs text-ink">{fmtRange(row.startDate, row.endDate)}</div>
                  <div className="text-[10.5px] text-muted">
                    {row.dayCount} day{row.dayCount === 1 ? '' : 's'}
                  </div>
                </Link>

                <div>
                  <Chip tone={row.statusTone}>{row.statusLabel}</Chip>
                </div>

                <Crewed row={row} />

                <div className="truncate text-xs text-muted">{row.schedulerName || '—'}</div>

                <div className="flex justify-end">
                  {canArchive && <ArchiveShowButton showId={row.id} archived={row.archived} />}
                </div>
              </div>
            ))}
          </div>

          {/* Below 1024px: the same rows, restacked. No column headers — a
              five-column grid at 375px is unreadable however hard it is
              squeezed, so the app restructures rather than shrinking. */}
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface lg:hidden">
            {shown.map(row => (
              <div key={row.id} className="px-4 py-3">
                <Link href={`/dashboard/shows/${row.id}`} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{row.name}</div>
                      <div className="truncate text-xs text-muted">
                        {fmtRange(row.startDate, row.endDate)} · {row.dayCount} day
                        {row.dayCount === 1 ? '' : 's'}
                      </div>
                      {(row.venue || row.cityState) && (
                        <div className="truncate text-xs text-muted">
                          {[row.venue, row.cityState].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <Chip tone={row.statusTone}>{row.statusLabel}</Chip>
                  </div>
                </Link>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {row.total === 0 ? (
                      <span className="text-xs text-muted">No call yet</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-20 rounded-pill bg-surface-2">
                          <div
                            className={cn(
                              'h-1 rounded-pill',
                              row.filled === row.total ? 'bg-good' : 'bg-accent',
                            )}
                            style={{ width: `${Math.max(Math.round((row.filled / row.total) * 100), 2)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted">
                          {Math.round((row.filled / row.total) * 100)}% · {row.peakPerDay} a day
                        </span>
                      </div>
                    )}
                  </div>
                  {canArchive && <ArchiveShowButton showId={row.id} archived={row.archived} />}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
