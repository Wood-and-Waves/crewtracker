import Link from 'next/link'
import Logo from '@/components/Logo'
import SiteFooter from '@/components/SiteFooter'

// Shared shell for /terms and /privacy: header, readable measure, footer.
//
// THE DRAFT BANNER
// ----------------
// `draft` renders a visible notice that the document has not been reviewed by a
// lawyer. It is on by default deliberately. These pages describe real
// obligations about other people's personal data — crew names, phone numbers and
// pay rates that a production company entered about third parties who never
// agreed to anything — and publishing them as settled terms before a solicitor
// has read them would misrepresent that.
//
// To publish for real: have them reviewed, then pass draft={false} on both
// pages. That is the only change needed.

export default function LegalPage({
  title,
  updated,
  draft = true,
  children,
}: {
  title: string
  updated: string
  draft?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-line px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="font-bold text-ink">CrewTracker</span>
          </Link>
          <Link href="/login" className="text-sm text-muted transition-colors hover:text-ink">
            Log In
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {updated}</p>

        {draft && (
          <div className="mt-6 rounded-card border border-line bg-surface p-4 ring-1 ring-inset ring-accent">
            <p className="text-sm font-semibold text-ink">Draft — not yet reviewed by a lawyer</p>
            <p className="mt-1 text-sm text-muted">
              This document describes how CrewTracker actually works today, but it has not had
              legal review. Please don&rsquo;t rely on it as a final agreement yet.
            </p>
          </div>
        )}

        {/* Prose styling lives here so the page files stay readable as documents. */}
        <div
          className="mt-8 space-y-6 text-sm leading-relaxed text-muted
                     [&_a]:text-accent [&_a]:underline
                     [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink
                     [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-ink
                     [&_li]:ml-5 [&_li]:list-disc [&_li]:marker:text-line
                     [&_strong]:text-ink [&_ul]:space-y-2"
        >
          {children}
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
