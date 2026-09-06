import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// Throttling for the public, no-login write routes — the only three places a
// stranger holding a link can make the app do work: /api/clock/punch,
// /api/clock/identify and /api/bookings/respond. Nothing else had any throttle
// (CLAUDE.md security backlog, 2026-09-04).
//
// The counter lives in the database (migration 0025) because Vercel serves a
// route from several instances that share no memory; see the migration header.
// Every caller already holds the service-role client and already pays a round
// trip to the same database, so one upsert is the floor.
//
// FAILS CLOSED. If the counter cannot be reached the request is refused with a
// 503, not waved through: the write these routes go on to make needs the same
// database, so "the database is down" is not a state in which letting the
// request past would have helped anybody.

export type RateLimitRule = {
  /** Namespaced so two routes never share a counter, e.g. 'punch:<token>'. */
  key: string
  /** Hits allowed per window. */
  limit: number
  windowSeconds: number
}

/**
 * True when every rule still has room. Checks all of them (so each counter
 * moves) and refuses if any is over — a leaked token AND a hostile IP are
 * both stopped.
 */
export async function withinRateLimit(admin: SupabaseClient, rules: RateLimitRule[]): Promise<boolean> {
  const results = await Promise.all(rules.map(r =>
    admin.rpc('rate_limit_hit', { p_key: r.key, p_limit: r.limit, p_window_seconds: r.windowSeconds }),
  ))
  for (const { data, error } of results) {
    if (error) throw new Error(`rate limiter: ${error.message}`)
    if (data !== true) return false
  }
  return true
}

/**
 * The visitor's address as Vercel reports it. The first entry of
 * x-forwarded-for is the client; Vercel sets it and strips anything a client
 * sent, so it is not spoofable in production. Absent locally, hence the
 * fallback — a shared counter for everyone on localhost is fine.
 */
export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || request.headers.get('x-real-ip')
    || 'local'
}

/** The response a throttled caller gets. Plain words: a crew member may read it. */
export function tooManyRequests(): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': '300' } },
  )
}

/** The response when the limiter itself cannot be reached (fails closed). */
export function limiterUnavailable(): NextResponse {
  return NextResponse.json(
    { error: 'The service is busy. Please try again in a moment.' },
    { status: 503, headers: { 'Retry-After': '30' } },
  )
}

/**
 * Runs the rules and returns the response to send if the caller must be
 * stopped, or null to proceed. Keeps each route to one line:
 *   const stop = await rateLimitOr(admin, [...]); if (stop) return stop
 */
export async function rateLimitOr(admin: SupabaseClient, rules: RateLimitRule[]): Promise<NextResponse | null> {
  try {
    return (await withinRateLimit(admin, rules)) ? null : tooManyRequests()
  } catch (e) {
    console.error(e)
    return limiterUnavailable()
  }
}
