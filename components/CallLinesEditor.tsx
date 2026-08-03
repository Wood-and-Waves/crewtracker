'use client'

import RolePicker from '@/components/RolePicker'
import { mergeLines, type GridLine } from '@/lib/crewCallGrid'

// Building a crew call as a list: 1 × A1, 1 × V1, 2 × Stagehand.
//
// A call is ONE THOUGHT — "main stage is an A1, a V1 and two stagehands" — and
// the first version of this made you enter it as three separate saves. Lines
// stack up here and are committed once by whatever is hosting the editor, so
// the shape of the UI matches the shape of the decision.
//
// Controlled and storage-agnostic on purpose: New Show holds these in memory
// for a room that does not exist yet, while the crew call panel commits them
// straight to an existing room. Same component, because they are the same idea.
//
// A line used to carry a `scope` ("first and last day", "middle days only").
// That was the answer before the grid existed, and its dropdown had already
// stopped rendering — the only caller never passed the dayCount it was gated on.
// Choosing days is now done by ticking them, which is the same idea shown
// rather than described. CallLine is therefore just GridLine.

export type CallLine = GridLine

export default function CallLinesEditor({
  roles,
  lines,
  onChange,
}: {
  roles: string[]
  lines: CallLine[]
  onChange: (next: CallLine[]) => void
}) {
  const total = lines.reduce((n, l) => n + l.quantity, 0)

  return (
    <div>
      {lines.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {lines.map(l => (
            <li
              key={l.role}
              className="flex items-center gap-1.5 rounded-pill border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-xs text-ink"
            >
              <span className="font-semibold">{l.quantity}×</span> {l.role}
              <button
                type="button"
                onClick={() => onChange(lines.filter(x => x.role !== l.role))}
                aria-label={`Remove ${l.role}`}
                className="rounded-full px-1.5 text-muted hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* mergeLines rather than a local copy of the bump rule — see its header. */}
      <RolePicker
        roles={roles}
        onAdd={(role, quantity) => onChange(mergeLines(lines, role, quantity))}
      />

      {total > 0 && (
        <p className="mt-1.5 text-[11px] text-muted">
          {total} position{total === 1 ? '' : 's'} on this call
        </p>
      )}
    </div>
  )
}
