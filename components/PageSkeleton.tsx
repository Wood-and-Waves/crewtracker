// The shape a screen has before its data arrives — what answers a click.
//
// It exists because measured click-to-paint on the live site was 550–900 ms
// with nothing on screen: the old page sat there until the new one was ready,
// which reads as a dead click. This is a paper-ground outline — masthead band,
// then ruled rows — so something answers at once. No text on purpose: it is a
// shape, not a message.
//
// EVERY SCREEN NEEDS ITS OWN loading.tsx, and that is the part that was learned
// the hard way (2026-10-04, on the preview). React shows a loading fallback only
// when a NEW Suspense boundary mounts. Clicking from the shows list into a show
// mounts shows/[id] fresh, so its skeleton appears. But Tracker → Scheduling →
// Edit → Reports are CHILDREN of that already-mounted segment, and a navigation
// inside a mounted boundary is a transition: React keeps the old screen until
// the new one is ready, and the parent's skeleton never shows. Measured: tracker
// → Edit Show held the tracker on screen for 1.8 s with shows/[id]/loading.tsx
// in place. So each child route carries a three-line loading.tsx of its own,
// which mounts a boundary of its own, which shows this.
//
// Two shapes: 'page' (a list or a ruled-sections screen) and 'show' (the
// tracker, with its stat strip and room band), so the real page lands where
// the outline was rather than jumping.

import { BAND } from '@/lib/panel'
import { cn } from '@/lib/cn'

const PAGE_ROWS = [
  ['w-1/3', 'w-1/5', 'w-1/6'],
  ['w-2/5', 'w-1/4'],
  ['w-1/4', 'w-1/5', 'w-1/5'],
  ['w-1/2', 'w-1/6'],
  ['w-1/3', 'w-1/4', 'w-1/6'],
]

const CREW_ROWS = [
  ['w-1/4', 'w-1/6', 'w-1/3'],
  ['w-1/5', 'w-1/6', 'w-2/5'],
  ['w-1/3', 'w-1/6', 'w-1/4'],
  ['w-1/4', 'w-1/6', 'w-1/3'],
]

function Rows({ rows, inset }: { rows: string[][]; inset?: boolean }) {
  return (
    <>
      {rows.map((widths, i) => (
        <div key={i} className={cn('flex items-center gap-6 border-b border-line py-4', inset && 'px-4')}>
          {widths.map((w, j) => (
            <div key={j} className={cn('h-4 animate-pulse rounded-field bg-surface-2', w)} />
          ))}
        </div>
      ))}
    </>
  )
}

export default function PageSkeleton({ shape = 'page' }: { shape?: 'page' | 'show' }) {
  return (
    <div className="p-6 md:p-10" aria-busy="true">
      <div className={cn(BAND, '-mx-6 mb-6 flex items-center px-6 py-4 md:-mx-10 md:px-10')}>
        <div className={cn('animate-pulse rounded-field bg-band-ink/20', shape === 'show' ? 'h-7 w-64' : 'h-6 w-48')} />
      </div>

      {shape === 'show' ? (
        <>
          <div className="mb-8 flex items-center gap-8">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-10 w-24 animate-pulse rounded-field bg-surface-2" />
            ))}
          </div>
          <div className={cn(BAND, 'flex items-center px-4 py-2')}>
            <div className="h-5 w-40 animate-pulse rounded-field bg-band-ink/20" />
          </div>
          <Rows rows={CREW_ROWS} inset />
        </>
      ) : (
        <Rows rows={PAGE_ROWS} />
      )}
    </div>
  )
}
