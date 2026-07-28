import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
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

  if (
    !user &&
    request.nextUrl.pathname !== "/" &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !request.nextUrl.pathname.startsWith("/invite") &&
    !request.nextUrl.pathname.startsWith("/api/beta-signup") &&
    !request.nextUrl.pathname.startsWith("/api/keepalive") &&
    // Booking requests. Crew have no login and never will under the current
    // plan, so both the page and the route it posts to must be reachable
    // signed-out — the token is the authorization. Omitting either is the
    // 307-to-/login trap that already caught the keepalive cron and the web
    // manifest; here it would ask a crew member to sign in to an app they have
    // no account for.
    !request.nextUrl.pathname.startsWith("/book") &&
    !request.nextUrl.pathname.startsWith("/api/bookings/respond") &&
    // The dev sign-in route has to be reachable without a session — that is its
    // entire job — and forgetting this allowlist is the 307-to-/login trap that
    // has already caught the keepalive cron and the web manifest. Compiled out
    // of every deployed build: NODE_ENV is inlined at build time and Vercel
    // builds everything, preview included, as production.
    !(process.env.NODE_ENV === "development" && request.nextUrl.pathname.startsWith("/api/dev/")) &&
    !request.nextUrl.pathname.startsWith("/join-beta")
  ) {
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
