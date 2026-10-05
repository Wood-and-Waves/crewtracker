// What the user sees between clicking into a show (or stepping to another day)
// and the server finishing the tracker. It exists because measured
// click-to-paint was 550-900 ms with nothing on screen. Shaped like the tracker
// so the page does not jump when the real one arrives: the show masthead band,
// the stat strip, a room band, then crew rows. No text on purpose.

import { BAND } from '@/lib/panel'
import { cn } from '@/lib/cn'

const CREW_ROWS = [
  ['w-1/4', 'w-1/6', 'w-1/3'],
  ['w-1/5', 'w-1/6', 'w-2/5'],
  ['w-1/3', 'w-1/6', 'w-1/4'],
  ['w-1/4', 'w-1/6', 'w-1/3'],
]

export default function ShowLoading() {
  return (
    <div className="p-6 md:p-10" aria-busy="true">
      <div className={cn(BAND, '-mx-6 mb-6 flex items-center px-6 py-4 md:-mx-10 md:px-10')}>
        <div className="h-7 w-64 animate-pulse rounded-field bg-band-ink/20" />
      </div>

      <div className="mb-8 flex items-center gap-8">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-10 w-24 animate-pulse rounded-field bg-surface-2" />
        ))}
      </div>

      <div className={cn(BAND, 'flex items-center px-4 py-2')}>
        <div className="h-5 w-40 animate-pulse rounded-field bg-band-ink/20" />
      </div>
      {CREW_ROWS.map((widths, i) => (
        <div key={i} className="flex items-center gap-6 border-b border-line px-4 py-4">
          {widths.map((w, j) => (
            <div key={j} className={cn('h-4 animate-pulse rounded-field bg-surface-2', w)} />
          ))}
        </div>
      ))}
    </div>
  )
}
