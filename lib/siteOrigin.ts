// The origin the app puts into the links it EMAILS — booking requests, invites,
// the scheduler handoff, the decline notice.
//
// Never from the request. `new URL(request.url).origin` is the Host header,
// and the Host header is whatever the caller sent: a request to a public route
// with a forged Host would have put an attacker's domain into an email the app
// sent to a PM, under the app's own sender. (CLAUDE.md security backlog,
// 2026-09-04; fixed 2026-09-06.)
//
// Resolution, first match wins:
//   NEXT_PUBLIC_SITE_URL  — an explicit override, if one is ever set;
//   production on Vercel  — the real domain, fixed;
//   a preview on Vercel   — that deployment's own URL, so a link from a preview
//                           opens the preview (behind Vercel's login, as ever);
//   otherwise             — the dev server.
// VERCEL_ENV and VERCEL_URL are set by the platform on every build; VERCEL_URL
// carries no scheme.

export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  if (process.env.VERCEL_ENV === 'production') return 'https://crewtracker.app'
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
