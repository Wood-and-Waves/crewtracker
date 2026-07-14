"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/cn"

type Theme = "light" | "dark"

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme")
  if (attr === "light" || attr === "dark") return attr
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme)
  try {
    localStorage.setItem("ct-theme", theme)
  } catch {
    /* ignore */
  }
}

// Small pill that flips light/dark. Reads the live theme on mount so it
// stays in sync with the no-flash script and the OS preference.
export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>("dark")

  useEffect(() => {
    setThemeState(currentTheme())
  }, [])

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    setTheme(next)
    setThemeState(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className={cn(
        "rounded-field border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent",
        className,
      )}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  )
}
