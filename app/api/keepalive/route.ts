import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily Vercel Cron hits this route (see vercel.json) to run one trivial
// query against Supabase. That single request counts as database activity,
// which resets Supabase's free-tier 7-day inactivity pause timer.
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
  const { error } = await supabase
    .from("organizations")
    .select("id")
    .limit(1);

  if (error) {
    console.error("keepalive: Supabase query failed", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
