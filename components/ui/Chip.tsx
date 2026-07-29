import { cn } from "@/lib/cn"

// Status chip. `tone` carries semantic state (separate from the brand accent):
// live = in progress, ot = overtime, good = complete/ok, danger = needs attention,
// staffing = being crewed.
type Tone = "neutral" | "live" | "ot" | "good" | "danger" | "staffing" | "preshow" | "archived"

// Tinted fill, not just an outline. An outline-only chip is a hairline of
// colour on a light background — legible if you are looking for it, invisible
// when you are scanning a list of fifteen shows. The fill carries the colour at
// the size of the chip rather than the width of its border.
const tones: Record<Tone, string> = {
  neutral: "border-line bg-surface-2 text-muted",
  live: "border-accent/40 bg-accent/12 text-accent",
  ot: "border-ot/40 bg-ot/12 text-ot",
  good: "border-good/40 bg-good/12 text-good",
  danger: "border-danger/40 bg-danger/12 text-danger",
  // Crewing in progress. Deliberately not the amber used for "needs
  // attention": a show being staffed is on track, not a problem.
  staffing: "border-staffing/40 bg-staffing/12 text-staffing",
  preshow: "border-preshow/40 bg-preshow/12 text-preshow",
  archived: "border-archived/40 bg-archived/12 text-archived",
}

export default function Chip({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
