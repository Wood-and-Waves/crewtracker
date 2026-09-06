import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  // Public paths are decided BEFORE the auth call, not after. Until 2026-09-06
  // this ran supabase.auth.getUser() — a network round trip to the auth server —
  // on every matched request and only then consulted this list, so the
  // marketing page, the crew clock, the booking page, every /api/clock and
  // /api/bookings/respond call and the daily keepalive cron each paid for a
  // session check whose answer was thrown away. Same list, same rules; the only
  // change is the order. A signed-in visitor on a public path skips the cookie
  // refresh, which the next dashboard request performs anyway.
  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/invite") ||
    path.startsWith("/api/beta-signup") ||
    path.startsWith("/api/keepalive") ||
    // Booking requests. Crew have no login and never will under the current
    // plan, so both the page and the route it posts to must be reachable
    // signed-out — the token is the authorization. Omitting either is the
    // 307-to-/login trap that already caught the keepalive cron and the web
    // manifest; here it would ask a crew member to sign in to an app they have
    // no account for.
    path.startsWith("/book") ||
    path.startsWith("/api/bookings/respond") ||
    // Crew clock links, same bargain as booking requests above: the page AND
    // the routes it posts to must both be reachable signed-out, or a crew
    // member gets asked to log in to an app they have no account for. The
    // /api/clock prefix covers both identify and punch deliberately — two
    // separate clauses is two chances to forget one.
    path.startsWith("/clock") ||
    path.startsWith("/api/clock") ||
    // The dev sign-in route has to be reachable without a session — that is its
    // entire job — and forgetting this allowlist is the 307-to-/login trap that
    // has already caught the keepalive cron and the web manifest. Compiled out
    // of every deployed build: NODE_ENV is inlined at build time and Vercel
    // builds everything, preview included, as production.
    (process.env.NODE_ENV === "development" && path.startsWith("/api/dev/")) ||
    path.startsWith("/join-beta")

  if (isPublic) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Everything that reaches here is a protected path; the allowlist above
  // already returned for the public ones.
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // manifest.webmanifest is excluded by name for the same reason favicon.ico
    // is: it's a static asset that must be fetchable without a session. The
    // extension list below doesn't cover .webmanifest, so without this the
    // middleware answered it with a 307 to /login — meaning iOS and Chrome
    // received an HTML login page instead of the manifest, and the Home Screen
    // app got no name, no icon and no standalone mode. Same trap the keepalive
    // cron hit (see CLAUDE.md).
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
