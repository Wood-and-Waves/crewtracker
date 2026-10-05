// What the user sees between clicking a dashboard link and the server
// finishing the page. It exists because measured click-to-paint was 550-900 ms
// with nothing on screen at all: the old screen sat there until the new one was
// ready, which reads as a dead click. This is a paper-ground outline of the
// usual screen (masthead band, then ruled rows) so something answers the click
// at once. No text on purpose: it is a shape, not a message.

import { BAND } from '@/lib/panel'
import { cn } from '@/lib/cn'

const ROW_WIDTHS = [
  ['w-1/3', 'w-1/5', 'w-1/6'],
  ['w-2/5', 'w-1/4'],
  ['w-1/4', 'w-1/5', 'w-1/5'],
  ['w-1/2', 'w-1/6'],
  ['w-1/3', 'w-1/4', 'w-1/6'],
]

export default function DashboardLoading() {
  return (
    <div className="p-6 md:p-10" aria-busy="true">
      <div className={cn(BAND, '-mx-6 mb-6 flex items-center px-6 py-4 md:-mx-10 md:px-10')}>
        <div className="h-6 w-48 animate-pulse rounded-field bg-band-ink/20" />
      </div>
      {ROW_WIDTHS.map((widths, i) => (
        <div key={i} className="flex items-center gap-6 border-b border-line py-4">
          {widths.map((w, j) => (
            <div key={j} className={cn('h-4 animate-pulse rounded-field bg-surface-2', w)} />
          ))}
        </div>
      ))}
    </div>
  )
}
