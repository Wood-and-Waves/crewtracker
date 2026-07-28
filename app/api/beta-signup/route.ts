import { NextResponse } from "next/server";
import { Resend } from "resend";

// Constructed inside the handler, NOT at module scope.
//
// `next build` imports every route module while collecting page data, so a
// top-level `new Resend(process.env.RESEND_API_KEY)` runs at BUILD time — and
// Resend throws immediately when the key is missing. That made the whole build
// fail in any environment without the secret, which is why every Vercel Preview
// deployment errored while Production (where the key is set) was fine.
//
// A missing key should break the one request that needs to send an email, not
// the build. app/api/reports/final/route.ts already does it this way.
function mailer() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const {
    name,
    email,
    company,
    teamSize,
    adminUsers,
    notes,
    company_website, // honeypot: real users never see or fill this field
  } = body;

  // Bot caught the honeypot — pretend success, send nothing.
  if (company_website) {
    return NextResponse.json({ ok: true });
  }

  if (!name || !email || !teamSize || !adminUsers) {
    return NextResponse.json(
      { error: "Please fill in your name, email, team size, and number of admin users." },
      { status: 400 }
    );
  }

  const resend = mailer();
  if (!resend) {
    // Only reachable in an environment with no RESEND_API_KEY — a Preview
    // deployment, say. Log it and tell the truth rather than reporting success
    // for a form submission that went nowhere.
    console.error("beta-signup: RESEND_API_KEY is not set; cannot send.");
    return NextResponse.json(
      { error: "Something went wrong sending your request. Please try again." },
      { status: 500 }
    );
  }

  try {
    await resend.emails.send({
      from: "CrewTracker <hello@contact.crewtracker.app>",
      to: "dan@theaudiosmith.com",
      subject: `New Beta Interest: ${company || name}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company || "(not provided)"}`,
        `Team size: ${teamSize}`,
        `Admin users needed: ${adminUsers}`,
        `Notes: ${notes || "(none)"}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("beta-signup: Resend send failed", err);
    return NextResponse.json(
      { error: "Something went wrong sending your request. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
