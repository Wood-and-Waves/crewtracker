// THE ONE DOOR EVERY EMAIL LEAVES THROUGH.
//
// Dan, 2026-09-08: "I have real people on the production site. I cannot test
// there. Emails would go out." So testing happens on dev — and dev sends real
// mail to whatever address is on the row. The seeded crew are all
// `@example.test`, which bounces, and a bounce rate is charged against
// contact.crewtracker.app, the same domain the real invitations go out on.
//
// So: when the app is NOT pointed at the production database, every message is
// redirected to ONE inbox, with the intended recipient written into the
// subject. You can send yourself booking requests, PM invitations, ready
// emails and digests all day and never reach a stranger.
//
// THE TEST IS THE DATABASE, NOT NODE_ENV. Vercel builds every deployment with
// NODE_ENV=production, preview included — and the preview is exactly where this
// has to work, because it carries the DEV database and its fake crew.
// NEXT_PUBLIC_SUPABASE_URL names the project, so that is what decides.
//
// IT FAILS CLOSED. On a non-production database with no DEV_EMAIL_TO set,
// nothing is sent and the caller is told who it would have gone to. Silence
// would be worse: this is the layer that is supposed to make testing safe.
//
// The Supabase Auth emails (magic link, password reset, recovery) do NOT come
// through here — Supabase sends those itself over its own SMTP — so they still
// reach whatever address is typed into the login page.
//
// Plain module. Resend is constructed PER CALL, never at module scope: a
// top-level `new Resend(...)` throws during `next build` when the key is
// absent, which broke every Preview deployment on 2026-07-27.

// THE SIGN-OFF SAYS WHO CAUSED THE SEND (Dan, 2026-09-09):
//
//   "Sent by CrewTracker.app"   — the app decided. Nobody pressed anything:
//                                 the evening digest and the fully-staffed
//                                 email, which fires when the last
//                                 confirmation lands.
//   "Sent from CrewTracker.app" — a person pressed something and this went out
//                                 as a result: every invitation, request,
//                                 change notice, decline notice, handoff and
//                                 the Final Report.
//
// A new sender picks one of the two. The distinction is worth keeping because
// it tells the reader whether a human is behind the message, which decides
// whether it is worth replying to anybody about.

import { Resend } from 'resend'

const PRODUCTION_REF = 'nfrvxkwemtittrqboebl'

/** Is this process talking to the production database? */
export function isProductionData(url = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  return (url ?? '').includes(PRODUCTION_REF)
}

export type OutgoingEmail = {
  from: string
  to: string | string[]
  subject: string
  text: string
  html?: string
  attachments?: { filename: string; content: Buffer | string }[]
}

/**
 * Where a message should actually go. Pure, so the rule is unit-tested rather
 * than discovered by somebody's real crew receiving a test.
 */
export function routeEmail(input: {
  to: string | string[]
  subject: string
  productionData: boolean
  devInbox?: string | null
}): { to: string | string[]; subject: string } | { blocked: string } {
  if (input.productionData) return { to: input.to, subject: input.subject }
  const intended = Array.isArray(input.to) ? input.to.join(', ') : input.to
  const inbox = (input.devInbox ?? '').trim()
  if (!inbox) {
    return { blocked: `Not sent: this is not the production database and DEV_EMAIL_TO is not set. It would have gone to ${intended}.` }
  }
  return { to: inbox, subject: `[dev → ${intended}] ${input.subject}` }
}

export async function sendEmail(mail: OutgoingEmail): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured.' }

  const routed = routeEmail({
    to: mail.to,
    subject: mail.subject,
    productionData: isProductionData(),
    devInbox: process.env.DEV_EMAIL_TO,
  })
  if ('blocked' in routed) return { error: routed.blocked }

  try {
    const { error } = await new Resend(key).emails.send({
      ...mail,
      to: routed.to,
      subject: routed.subject,
    } as Parameters<Resend['emails']['send']>[0])
    if (error) return { error: error.message }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
