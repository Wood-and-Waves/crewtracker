'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import ThemeToggle from '@/components/ui/ThemeToggle'
import AccountMenu, { type SwitcherOrg } from '@/components/ui/AccountMenu'
import Logo from '@/components/Logo'

const baseNavItems = [
  { href: '/dashboard', label: 'Shows', icon: 'briefcase', match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/shows') },
  { href: '/dashboard/schedule', label: 'Schedule', icon: 'calendar', match: (p: string) => p.startsWith('/dashboard/schedule') },
  { href: '/dashboard/directory', label: 'Directory', icon: 'users', match: (p: string) => p.startsWith('/dashboard/directory') },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings', match: (p: string) => p.startsWith('/dashboard/settings') },
]

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
}: {
  children: React.ReactNode
  canManageUsers?: boolean
  isSuperAdmin?: boolean
  userName?: string
  organizations?: SwitcherOrg[]
  userEmail?: string
}) {
  const pathname = usePathname()
  const navItems = [
    ...baseNavItems,
    ...(canManageUsers ? [teamNavItem] : []),
    ...(isSuperAdmin ? [superAdminNavItem] : []),
  ]
  // The tab-bar is width-constrained in a way the top nav is not; see the
  // comment on superAdminNavItem. Five items is the ceiling at 375px.
  const tabItems = navItems.filter(item => item.href !== superAdminNavItem.href)

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      {/* Desktop / landscape-iPad: top nav for mouse navigation.
          bg-bg, not bg-surface: the chrome IS the paper. A white strip over the
          warm ground was the brightest thing on every screen and read as a
          foreign toolbar rather than the top of the page. Opaque so content
          scrolling under the sticky bar stays hidden. */}
      <header className="sticky top-0 z-40 hidden items-center gap-2 border-b border-line bg-bg px-6 py-3 lg:flex">
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

      <main className="flex-1 pb-28 lg:pb-0">{children}</main>

      {/* Portrait iPad / phone: fixed bottom tab-bar. A true overlay, so it
          keeps a box — but the Showbill one: squared, 2px ink edge, hard
          offset shadow. The 26px pill it used to be was the "iOS forced to
          big screen" disease in miniature. */}
      <nav className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-0.5 border-2 border-ink bg-surface p-1.5 shadow-edge lg:hidden">
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
