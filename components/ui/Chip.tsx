import { cn } from "@/lib/cn"

// Status chip. `tone` carries semantic state (separate from the brand accent):
// live = in progress, ot = overtime, good = complete/ok, danger = needs attention.
type Tone = "neutral" | "live" | "ot" | "good" | "danger"

const tones: Record<Tone, string> = {
  neutral: "border-line text-muted",
  live: "border-accent text-accent",
  ot: "border-ot text-ot",
  good: "border-good text-good",
  danger: "border-danger text-danger",
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
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
