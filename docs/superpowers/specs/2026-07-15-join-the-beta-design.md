# Join the Beta — landing page CTA + interest form

Status: approved
Date: 2026-07-15

## Purpose

Replace the landing page's "Get Started" CTA (currently `/login`, a dead end for
non-users) with a lead-capture interest form, "Join the Beta." Submissions email
Dan directly — no self-serve signup or account creation is implied. This is a
lead funnel ahead of the existing superadmin-invite onboarding path, not a
replacement for it.

## Scope

In scope:
- Landing page CTA label + link change.
- New public route `/join-beta` with an interest form.
- New API route that validates input and sends a notification email via Resend.

Explicitly out of scope (decided during brainstorming):
- No database persistence of submissions (email is the record).
- No separate thank-you page (inline success message instead).
- No rate limiting beyond a honeypot field.
- No admin UI to view/manage submissions.
- No changes to the actual onboarding/invite flow.

## Landing page change

`app/page.tsx`: the CTA button's label changes from `Get Started` to
`Join the Beta`; its `href` changes from `/login` to `/join-beta`. No other
landing page changes.

## New route: `/join-beta`

- `app/join-beta/page.tsx` — server component, static shell styled consistently
  with the landing page (same logo, Signal design tokens, light/dark support).
- `app/join-beta/JoinBetaForm.tsx` — client component containing the actual form.

### Form fields

- Name (required)
- Email (required)
- Company Name (optional)
- Team Size — number of crew tracked (required)
- Number of Admin Users Needed (required)
- Anything else? — free-text textarea (optional)
- Hidden honeypot field (e.g. `company_website`), visually hidden off-screen,
  never shown or filled by real users.

### Submit behavior

- On submit, POST JSON to `/api/beta-signup`.
- Submit button disables while the request is in flight.
- On success: form is replaced inline with a "Thanks — we'll be in touch"
  message. No redirect.
- On failure: an inline error message is shown and the form remains filled in
  so the user can retry (per CLAUDE.md's "surface errors, don't fail silently"
  principle — no silent no-op on error).

## New API route: `app/api/beta-signup/route.ts`

- Validates required fields are present (name, email, team size, admin users
  needed). Company name and notes are optional.
- Honeypot check: if `company_website` (or equivalent hidden field) is
  non-empty, respond with a fake `200` success immediately, without sending an
  email. This silently drops bot submissions without tipping off scrapers.
- On valid submission, sends an email via the `resend` npm package:
  - From: an address on the already-verified `contact.crewtracker.app` domain
    in Dan's Resend account (exact local part decided at implementation time,
    e.g. `hello@contact.crewtracker.app`).
  - To: `dan@theaudiosmith.com`
  - Subject: `New Beta Interest: {company name or person's name}`
  - Body: all submitted fields listed plainly.
- On a Resend API error, the route logs the real error server-side and returns
  a `500` with a generic client-facing error message, which the form surfaces
  to the user (see Submit behavior above).
- No database writes of any kind.

## New dependency & config

- npm package: `resend`
- Env var: `RESEND_API_KEY` (server-only — added to `.env.local` and to Vercel
  project settings, same handling as `SUPABASE_SERVICE_ROLE_KEY`; never exposed
  to the browser).

## Relationship to existing "Known gaps" doc entries

This implements the "Join the Beta" interest form gap and the email-delivery
groundwork (Resend wiring) both noted in `CLAUDE.md`'s Known Gaps section.
Report-delivery emails (a separate, larger feature using
`organizations.default_cc_email`) are NOT part of this work — this spec only
covers the beta interest form's one-off notification email. The Resend
package/env var this introduces will likely be reused later for report
delivery, but that integration is out of scope here.
