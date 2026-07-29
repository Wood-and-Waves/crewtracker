'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'

// Settings as a nav and one section at a time.
//
// It was two columns side by side with two full-width panels underneath. The
// columns were never the same height — Personal is roughly twice Organization —
// so there was always a ragged gap between them, and AV Roles and Payroll
// Presets sat below the fold behind a scroll past everything else.
//
// One section at a time fixes both at once: nothing can be ragged against
// anything, every section gets the full width, and the two that used to be
// buried are one click away.
//
// Sections arrive as already-rendered nodes so each one stays a Server
// Component — this file only decides which is on screen.

export type SettingsSection = {
  id: string
  label: string
  /** Sub-heading under the section title. */
  description?: string
  node: React.ReactNode
}

export default function SettingsLayout({ sections }: { sections: SettingsSection[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id)
  const active = sections.find(s => s.id === activeId) ?? sections[0]
  if (!active) return null

  return (
    <div className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
      {/* Desktop: a real left nav. Mobile: the same entries as a scrolling row
          of chips, matching the room tabs on the tracker. */}
      <nav className="mb-5 flex gap-1.5 overflow-x-auto lg:mb-0 lg:flex-col lg:overflow-visible">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={cn(
              'whitespace-nowrap rounded-field px-3 py-2 text-sm font-medium transition-colors',
              'lg:text-left',
              s.id === active.id
                ? 'bg-accent-wash text-accent'
                : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <section className="min-w-0">
        <h2 className="text-lg font-bold text-ink">{active.label}</h2>
        {active.description && (
          <p className="mb-4 mt-0.5 text-sm text-muted">{active.description}</p>
        )}
        <div className={active.description ? '' : 'mt-4'}>{active.node}</div>
      </section>
    </div>
  )
}
