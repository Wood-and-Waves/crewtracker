import { cn } from "@/lib/cn"

type Variant = "primary" | "ghost" | "danger"
type Size = "sm" | "md"

const base =
  "inline-flex items-center justify-center gap-2 font-semibold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-field"

const variants: Record<Variant, string> = {
  primary: "bg-accent/30 text-accent font-bold hover:opacity-80",
  ghost: "bg-surface border border-line text-ink hover:border-accent hover:text-accent",
  danger: "bg-danger text-white hover:opacity-90",
}

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
}

export default function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />
}
