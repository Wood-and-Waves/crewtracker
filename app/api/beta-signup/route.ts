import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

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
