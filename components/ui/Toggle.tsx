"use client"

import { cn } from "@/lib/cn"

// Accessible on/off switch. Controlled: pass `checked` and `onChange`.
export default function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[27px] w-[46px] flex-none rounded-pill border transition-colors disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        checked ? "bg-accent border-transparent" : "bg-surface-2 border-line",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[21px] w-[21px] rounded-full bg-white shadow-sm transition-[left]",
          checked ? "left-[21px]" : "left-[2px]",
        )}
      />
    </button>
  )
}
