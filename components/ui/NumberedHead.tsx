import { cn } from '@/lib/cn'
import { RULE_MAJOR } from '@/lib/panel'

// A numbered section head on open paper: blue number, condensed caps title,
// 3px ink rule. The Open Paper replacement for wrapping a section in a panel —
// numbering is earned here because a form's sections genuinely are a sequence.
//
// `children` land on the right of the rule line (an action button, typically).
// No 'use client', no hooks: renders in server and client trees alike.
export default function NumberedHead({
  n,
  title,
  note,
  className,
  children,
}: {
  n?: string
  title: string
  note?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 pb-2', RULE_MAJOR, className)}>
      {n && <span className="font-display text-2xl font-bold leading-none text-accent">{n}</span>}
      <span className="font-display text-[15px] font-semibold uppercase tracking-[0.1em] text-ink">
        {title}
      </span>
      <div className="ml-auto flex items-center gap-3">
        {note && (
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted">
            {note}
          </span>
        )}
        {children}
      </div>
    </div>
  )
}
