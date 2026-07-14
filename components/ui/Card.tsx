import { cn } from "@/lib/cn"

// Signal surface card. `interactive` adds the hover-accent border used on
// clickable cards (show tiles, etc.).
export default function Card({
  interactive = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-card",
        interactive && "cursor-pointer transition-colors hover:border-accent",
        className,
      )}
      {...props}
    />
  )
}
