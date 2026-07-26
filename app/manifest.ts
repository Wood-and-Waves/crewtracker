import type { MetadataRoute } from 'next'

// Web app manifest, so adding CrewTracker to a Home Screen produces a real app
// entry rather than a browser bookmark: proper name, proper icon, and no browser
// chrome once it opens.
//
// Icons deliberately point at /public assets rather than the app/ file-convention
// icons. Next serves those from hashed URLs (/icon.png?icon.05fwc6k7…), which a
// hand-written manifest can't reference reliably — the same reason
// public/app-icon.png already exists for the marketing page (see CLAUDE.md).
//
// The apple-touch-icon that iOS actually uses comes from app/apple-icon.png via
// Next's file convention, not from here; iOS largely ignores manifest icons.
// These entries are what Android and desktop Chrome install with.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CrewTracker',
    short_name: 'CrewTracker',
    description: 'Crew time tracking and payroll for corporate AV shows.',
    // Straight to the shows list; middleware sends an unauthenticated visitor
    // to /login from here anyway.
    start_url: '/dashboard',
    display: 'standalone',
    // Matches the dark theme's --bg / --surface tokens in globals.css. The splash
    // and status bar are near-black either way, so a light-theme user doesn't get
    // a jarring flash.
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/app-icon.png', sizes: '1024x1024', type: 'image/png' },
    ],
  }
}
