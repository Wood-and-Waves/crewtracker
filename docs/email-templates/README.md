# Branding the Supabase auth emails

Supabase Auth — not the app — sends "Confirm your email", the magic-link sign-in,
password resets and email-change confirmations. They are configured in the
Supabase dashboard, so they can't be changed from this repo. The HTML lives here
so it's versioned and reviewable; applying it is a copy-paste.

**Do this on production. Dev can stay on the defaults** — nobody but us receives
its mail, and pointing dev at the same SMTP would send real email from test runs.

---

## Step 1 — Custom SMTP (do this first)

This matters more than the branding.

Supabase's built-in email service is **rate-limited and explicitly not for
production** — a handful of messages per hour across the whole project, shared by
every user. Onboarding one company could exhaust it, and the failure looks like
"the email never arrived" with nothing obviously wrong. Custom SMTP removes that
limit and is what makes the address say CrewTracker rather than
`noreply@mail.app.supabase.io`.

Dashboard → **Project Settings → Authentication → SMTP Settings** → enable
*Custom SMTP*:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your `RESEND_API_KEY` (the same one Vercel uses) |
| Sender email | `noreply@contact.crewtracker.app` |
| Sender name | `CrewTracker` |

That address is already the one the invitation emails send from, on a domain
verified with Resend, so SPF/DKIM are in place and messages are not treated as
suspicious. There is no separate DNS work.

While you're on that screen, raise the auth **rate limit** (Authentication →
Rate Limits → emails per hour) — the default is set low because it assumes the
built-in sender.

## Step 2 — the templates

Dashboard → **Authentication → Emails** (Email Templates). For each one below,
paste the file's contents into the message body and set the subject:

| Template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your email for CrewTracker |
| Magic Link | `magic-link.html` | Your CrewTracker sign-in link |
| Reset Password | `reset-password.html` | Reset your CrewTracker password |
| Change Email Address | `change-email.html` | Confirm your new email address for CrewTracker |

"Invite user" is deliberately left alone — CrewTracker does not use Supabase's
invite flow. Ours is `lib/inviteEmail.ts`, sent by the app, because it carries
the inviter's name, the company and the role, none of which Supabase knows about.

## Which of these the app can actually trigger

- **Confirm signup** — a new person accepting an invite with email + password
  (`app/invite/[token]/InviteAuthForm.tsx`)
- **Magic Link** — "Send magic link instead" on `/login`, and on the invite page
- **Reset Password** — "Forgot password?" on `/login`
- **Change Email Address** — not reachable from the UI today; templated so it
  isn't unbranded if it ever is

Google sign-in sends none of these.

## The variables

`{{ .ConfirmationURL }}` is the action link and must survive editing — it is the
entire point of the message. `change-email.html` also uses `{{ .Email }}` and
`{{ .NewEmail }}`. Leave the `{{ }}` untouched; Supabase substitutes them.

## After applying

Trigger one of each against an address you can read: request a password reset,
and use "Send magic link instead" on the login page. Check the sender says
CrewTracker, the link works, and it doesn't land in spam.

Styling matches `lib/inviteEmail.ts` — same font stack, same accent (`#3366CC`),
same footer. If you restyle one, restyle the others; a customer who gets an
invitation and then a password reset should not think two different products sent
them.
