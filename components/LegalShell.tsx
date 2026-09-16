// The frame both legal pages sit in. Deliberately NOT AppShell: these are read
// by people with no account — a crew member who got an email, or somebody
// deciding whether to sign up — so a dashboard nav would be furniture they
// cannot use.

import Link from 'next/link'
import Logo from '@/components/Logo'

export default function LegalShell({
  children,
  other,
}: {
  children: React.ReactNode
  other: { href: string; label: string }
}) {
  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[46rem] px-5 py-10 md:px-8 md:py-14">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 text-ink hover:opacity-80">
            <Logo className="h-7 w-7" />
            <span className="font-display text-lg font-bold uppercase tracking-wide">CrewTracker</span>
          </Link>
          <Link href={other.href} className="text-sm text-accent hover:underline">{other.label}</Link>
        </div>

        {children}

        <div className="mt-12 border-t border-line pt-5 text-xs text-muted">
          <Link href="/" className="hover:text-ink">crewtracker.app</Link>
          <span className="mx-2">·</span>
          <Link href={other.href} className="hover:text-ink">{other.label}</Link>
        </div>
      </div>
    </div>
  )
}
