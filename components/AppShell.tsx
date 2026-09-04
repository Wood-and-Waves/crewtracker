'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import ThemeToggle from '@/components/ui/ThemeToggle'
import AccountMenu, { type SwitcherOrg } from '@/components/ui/AccountMenu'
import Logo from '@/components/Logo'

const baseNavItems = [
  { href: '/dashboard', label: 'Shows', icon: 'briefcase', match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/shows') },
  { href: '/dashboard/directory', label: 'Directory', icon: 'users', match: (p: string) => p.startsWith('/dashboard/directory') },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings', match: (p: string) => p.startsWith('/dashboard/settings') },
]

// The scheduling module. Present only for an organization that has it AND a
// member permitted to use it — see canUseScheduling() in lib/session.ts. Slotted
// after Shows rather than appended, so enabling the module doesn't reorder the
// nav somebody has learned.
const scheduleNavItem = { href: '/dashboard/schedule', label: 'Schedule', icon: 'calendar', match: (p: string) => p.startsWith('/dashboard/schedule') }

const teamNavItem = { href: '/dashboard/team', label: 'Team', icon: 'shield', match: (p: string) => p.startsWith('/dashboard/team') }

// Platform operator only. Lives in the nav so there's a way back to the admin
// area without typing the URL — previously /superadmin was reachable only from
// memory.
//
// DESKTOP ONLY, and that is a size decision, not a permission one. Adding
// Schedule took the bottom tab-bar to six items for a super admin, which does
// not fit at 375px. The top nav is a wide horizontal bar with room to spare, so
// it keeps every item; the tab-bar drops this one, because platform
// administration is the only entry here nobody does from a phone in a venue.
const superAdminNavItem = { href: '/superadmin', label: 'Platform', icon: 'shield', match: (p: string) => p.startsWith('/superadmin') }

function Icon({ name }: { name: string }) {
  if (name === 'briefcase') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
      </svg>
    )
  }
  if (name === 'users') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="9" cy="8.5" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16 6a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-2.5-4.4" />
      </svg>
    )
  }
  if (name === 'calendar') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    )
  }
  if (name === 'shield') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      </svg>
    )
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2" />
    </svg>
  )
}

export default function AppShell({
  children,
  canManageUsers = false,
  isSuperAdmin = false,
  userName,
  userEmail,
  organizations = [],
  version,
  canUseScheduling = false,
}: {
  children: React.ReactNode
  canManageUsers?: boolean
  isSuperAdmin?: boolean
  userName?: string
  organizations?: SwitcherOrg[]
  userEmail?: string
  /** App version, read from package.json by the server layout. Shown in the
   *  footer so a customer reporting a bug can say which build they are on. */
  version?: string
  /** Org has the scheduling module AND this member may use it. */
  canUseScheduling?: boolean
}) {
  const pathname = usePathname()
  const navItems = [
    baseNavItems[0],
    ...(canUseScheduling ? [scheduleNavItem] : []),
    ...baseNavItems.slice(1),
    ...(canManageUsers ? [teamNavItem] : []),
    ...(isSuperAdmin ? [superAdminNavItem] : []),
  ]
  // The tab-bar is width-constrained in a way the top nav is not; see the
  // comment on superAdminNavItem. Five items is the ceiling at 375px.
  const tabItems = navItems.filter(item => item.href !== superAdminNavItem.href)

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      {/* Desktop / landscape-iPad: top nav for mouse navigation.
          bg-surface-2 — a shade OF the paper, not a sheet on top of it. Pure
          white was the brightest thing on every screen and read as a foreign
          toolbar; matching the ground exactly left the chrome indistinguishable
          from the page. This warm tint is the middle Dan asked for. Opaque, so
          content scrolling under the sticky bar stays hidden. */}
      <header className="sticky top-0 z-40 hidden items-center gap-2 border-b border-line bg-surface-2 px-6 py-3 lg:flex print:hidden">
        <Link href="/dashboard" className="mr-5 flex items-center gap-2 text-[15px] font-extrabold">
          <span className="text-accent"><Logo /></span>
          CrewTracker
        </Link>
        {navItems.map(item => {
          const active = item.match(pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-field px-3.5 py-2 text-sm font-semibold transition-colors',
                active ? 'bg-accent-wash text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {item.label}
            </Link>
          )
        })}
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <AccountMenu userName={userName} userEmail={userEmail} organizations={organizations} />
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/* Footer. Sits at the bottom of the CONTENT, not fixed to the viewport —
          a bar pinned over a punch table would cost a row of crew on a phone.
          `mt-auto` on the flex column keeps it at the bottom on short pages.
          The bottom padding clears the floating tab bar below 1024px. */}
      <footer className="mt-auto border-t border-line px-6 pb-28 pt-5 lg:pb-6 print:hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-2 text-[13px] font-bold text-ink">
            <Logo className="h-5 w-5" />
            CrewTracker
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted">
            © 2026 · All rights reserved
          </span>
          {version && (
            <span className="ml-auto font-mono text-[10.5px] uppercase tracking-wide text-muted">
              v{version}
            </span>
          )}
        </div>
      </footer>

      {/* Portrait iPad / phone: fixed bottom tab-bar. A true overlay, so it
          keeps a box — but the Showbill one: squared, 2px ink edge, hard
          offset shadow. The 26px pill it used to be was the "iOS forced to
          big screen" disease in miniature. */}
      <nav className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-0.5 border-2 border-ink bg-surface p-1.5 shadow-edge lg:hidden print:hidden">
        {tabItems.map(item => {
          const active = item.match(pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-field px-3 py-2 text-[11px] font-semibold transition-colors sm:px-5',
                active ? 'bg-accent-wash text-accent' : 'text-muted',
              )}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
