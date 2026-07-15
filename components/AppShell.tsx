'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import ThemeToggle from '@/components/ui/ThemeToggle'
import Logo from '@/components/Logo'

const baseNavItems = [
  { href: '/dashboard', label: 'Shows', icon: 'briefcase', match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/shows') },
  { href: '/dashboard/directory', label: 'Directory', icon: 'users', match: (p: string) => p.startsWith('/dashboard/directory') },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings', match: (p: string) => p.startsWith('/dashboard/settings') },
]

const teamNavItem = { href: '/dashboard/team', label: 'Team', icon: 'shield', match: (p: string) => p.startsWith('/dashboard/team') }

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
}: {
  children: React.ReactNode
  canManageUsers?: boolean
}) {
  const pathname = usePathname()
  const navItems = canManageUsers ? [...baseNavItems, teamNavItem] : baseNavItems

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      {/* Desktop / landscape-iPad: top nav for mouse navigation */}
      <header className="sticky top-0 z-40 hidden items-center gap-2 border-b border-line bg-surface px-6 py-3 lg:flex">
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
        <ThemeToggle className="ml-auto" />
      </header>

      <main className="flex-1 pb-28 lg:pb-0">{children}</main>

      {/* Portrait iPad / phone: fixed bottom tab-bar, app-style */}
      <nav className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-0.5 rounded-[26px] border border-line bg-surface-2 p-1.5 shadow-xl lg:hidden">
        {navItems.map(item => {
          const active = item.match(pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-[20px] px-6 py-2 text-[11px] font-semibold transition-colors',
                active ? 'text-accent' : 'text-muted',
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
