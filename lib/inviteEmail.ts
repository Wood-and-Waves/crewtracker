// The invitation email.
//
// SERVER ONLY — it reads RESEND_API_KEY. Never import from a client component.
//
// Sent from a no-reply address, deliberately: a reply would go nowhere useful,
// and the person to talk to is the colleague who invited them, whose name and
// company are in the body. Same reasoning as the Final Report sender.
//
// The Resend client is constructed per call rather than at module scope. A
// top-level `new Resend(...)` throws during `next build` when the key is absent,
// which is what broke every Vercel Preview deployment until 2026-07-27.

import { Resend } from 'resend'

const FROM = 'CrewTracker <noreply@contact.crewtracker.app>'

export type InviteEmailInput = {
  to: string
  /** The organization being joined. */
  organizationName: string
  /** Display name of the person who sent the invite; may be unknown. */
  inviterName: string | null
  /** The inviter's own organization — normally the same one being joined. */
  inviterOrganizationName: string | null
  role: string | null
  link: string
  expiresAt: string
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  staff: 'Staff',
  pm: 'Production Manager',
  crew: 'Crew',
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildInviteEmail(input: InviteEmailInput) {
  const { organizationName, inviterName, inviterOrganizationName, role, link, expiresAt } = input

  // Company name in the subject so it is recognisable in a crowded inbox —
  // "CrewTracker" alone means nothing to someone who has never heard of it,
  // whereas the company that hired them does.
  const subject = inviterName
    ? `${inviterName} invited you to join ${organizationName} on CrewTracker`
    : `You've been invited to join ${organizationName} on CrewTracker`

  // "of {company}" only when the inviter's company differs from the one being
  // joined. For an ordinary teammate invite they are the same, and naming it
  // twice reads as a stutter: "Dan Smith of Wood and Waves has invited you to
  // join Wood and Waves". The company is still stated plainly in the next clause
  // and in the subject, so nothing is lost by dropping the repeat.
  const showInviterOrg =
    inviterOrganizationName && inviterOrganizationName !== organizationName
  const who = inviterName
    ? `${inviterName}${showInviterOrg ? ` of ${inviterOrganizationName}` : ''}`
    : 'An administrator'

  const roleLine = role ? `You'll join as: ${ROLE_LABEL[role] ?? role}` : null
  const expires = new Date(expiresAt).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const text = [
    `${who} has invited you to join ${organizationName} on CrewTracker.`,
    '',
    'CrewTracker is the tool they use to track crew hours and work out payroll for live events.',
    '',
    roleLine,
    '',
    'Accept your invitation:',
    link,
    '',
    `This link expires on ${expires}.`,
    '',
    'If you already have a CrewTracker account, sign in with it and this company will be',
    'added to your existing login — you can switch between them from your account menu.',
    '',
    "If you weren't expecting this, you can ignore this email.",
    '',
    '—',
    'This message was sent automatically. Please do not reply.',
  ].filter(l => l !== null).join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#18181b;">
  <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
    <strong>${escapeHtml(who)}</strong> has invited you to join
    <strong>${escapeHtml(organizationName)}</strong> on CrewTracker.
  </p>
  <p style="font-size:14px;line-height:1.6;color:#52525b;margin:0 0 24px;">
    CrewTracker is the tool they use to track crew hours and work out payroll for live events.
  </p>
  ${roleLine ? `<p style="font-size:14px;color:#52525b;margin:0 0 24px;">${escapeHtml(roleLine)}</p>` : ''}
  <p style="margin:0 0 24px;">
    <a href="${escapeHtml(link)}"
       style="display:inline-block;background:#3366CC;color:#ffffff;text-decoration:none;
              padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
      Accept invitation
    </a>
  </p>
  <p style="font-size:13px;color:#71717a;line-height:1.6;margin:0 0 8px;">
    Or paste this into your browser:<br>
    <span style="word-break:break-all;color:#3366CC;">${escapeHtml(link)}</span>
  </p>
  <p style="font-size:13px;color:#71717a;margin:0 0 24px;">This link expires on ${escapeHtml(expires)}.</p>
  <p style="font-size:13px;color:#71717a;line-height:1.6;margin:0 0 24px;">
    If you already have a CrewTracker account, sign in with it and this company will be added to
    your existing login — you can switch between them from your account menu.
  </p>
  <p style="font-size:12px;color:#a1a1aa;line-height:1.6;margin:24px 0 0;border-top:1px solid #e4e4e7;padding-top:16px;">
    If you weren't expecting this, you can ignore this email.<br>
    This message was sent automatically. Please do not reply.
  </p>
</div>`.trim()

  return { subject, text, html }
}

/**
 * Sends the invitation. Returns an error string rather than throwing, so a
 * failed send never loses the invitation itself — the row already exists and the
 * link still works, so the caller can report "created, but email failed" and the
 * admin can copy the link from the Team screen instead.
 */
export async function sendInviteEmail(input: InviteEmailInput): Promise<{ error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { error: 'Email is not configured on this environment.' }

  const { subject, text, html } = buildInviteEmail(input)

  try {
    // No replyTo: this is a no-reply sender by design.
    const { error } = await new Resend(key).emails.send({
      from: FROM,
      to: input.to,
      subject,
      text,
      html,
    })
    if (error) return { error: error.message }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send the email.' }
  }
}
