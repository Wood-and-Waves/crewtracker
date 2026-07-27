import Link from 'next/link'
import Logo from '@/components/Logo'

// The public site footer — landing page, Join the Beta, Terms, Privacy.
//
// Token-driven rather than page.module.css, because unlike the landing page's
// styles this is shared across several routes. The scoping rule in CLAUDE.md is
// about landing-page styles not leaking INTO the app; using the app's own design
// tokens here is the direction that rule wants.
//
// Not used inside /dashboard: the app has a fixed bottom tab-bar below 1024px
// that a footer would collide with, and legal links belong on the public site
// rather than underfoot on every tracker screen.

export default function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-line bg-bg px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo className="h-7 w-7" />
          <div>
            <div className="text-sm font-bold text-ink">CrewTracker</div>
            <div className="text-xs text-muted">Crew time and payroll for corporate AV shows.</div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <Link href="/join-beta" className="text-muted transition-colors hover:text-ink">
            Join the Beta
          </Link>
          <Link href="/login" className="text-muted transition-colors hover:text-ink">
            Log In
          </Link>
          <Link href="/privacy" className="text-muted transition-colors hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="text-muted transition-colors hover:text-ink">
            Terms
          </Link>
          <a
            href="mailto:hello@contact.crewtracker.app"
            className="text-muted transition-colors hover:text-ink"
          >
            Contact
          </a>
        </nav>
      </div>

      <div className="mx-auto mt-8 max-w-5xl text-xs text-muted">
        &copy; {year} CrewTracker. All rights reserved.
      </div>
    </footer>
  )
}
