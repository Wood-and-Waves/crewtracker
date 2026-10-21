import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily Vercel Cron hits this route (see vercel.json) to run one trivial
// query against Supabase. That single request counts as database activity,
// which resets Supabase's free-tier 7-day inactivity pause timer.
//
// IT PINGS THE DEV DATABASE TOO (2026-10-21). A cron runs only on production,
// and production's Supabase client is the production project — so the DEV
// project was touched only when somebody ran the app locally, opened a preview
// or ran the tests, and a quiet week got Supabase's "about to be paused" email
// (Dan: "I just got an email that the dev site is about to be paused"). The
// production deployment holds the dev project's URL and ANON key under
// KEEPALIVE_DEV_*, and this route reads one row of `shows` with them: RLS
// hides every row from anon, so the answer is an empty list, but the query
// ran and that is what resets the timer. Verified against dev: 200, `[]`.
// (`organizations` is NOT usable here: its policy calls a helper anon may not
// execute, so anon gets 42501 — the query still ran, but a keepalive that
// reports an error every day is one nobody trusts.) Anon on purpose — a
// service key for one project should not live in the other's deployment, and
// anon is enough to count as activity. A dev failure is reported in the JSON
// and the log, never a 500: production's own keepalive must not go red
// because the dev project is unreachable.
async function pingDev(): Promise<string> {
  const url = process.env.KEEPALIVE_DEV_SUPABASE_URL;
  const key = process.env.KEEPALIVE_DEV_SUPABASE_ANON_KEY;
  if (!url || !key) return "skipped: KEEPALIVE_DEV_* not set";
  try {
    const res = await fetch(`${url}/rest/v1/shows?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error("keepalive: dev ping failed", res.status, body);
      return `error: ${res.status}`;
    }
    return "ok";
  } catch (e) {
    console.error("keepalive: dev ping threw", e);
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function GET(request: Request) {
  // Harden the endpoint only if CRON_SECRET is configured in Vercel. Vercel
  // Cron automatically sends `Authorization: Bearer ${CRON_SECRET}` when the
  // env var is set. If it isn't set yet, the route still works (public) so the
  // keepalive is live from first deploy.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const [{ error }, dev] = await Promise.all([
    supabase.from("organizations").select("id").limit(1),
    pingDev(),
  ]);

  // Housekeeping for the rate limiter (migration 0025): counters older than a
  // day can never matter again — no window is longer than an hour — so the
  // table stays the size of one day's traffic. Best effort; a failure here
  // must not turn the keepalive itself red.
  const { error: purgeError } = await supabase
    .from("rate_limits")
    .delete()
    .lt("window_start", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (purgeError) console.error("keepalive: rate_limits purge failed", purgeError);

  if (error) {
    console.error("keepalive: Supabase query failed", error);
    return NextResponse.json(
      { ok: false, error: error.message, dev },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, dev, at: new Date().toISOString() });
}
