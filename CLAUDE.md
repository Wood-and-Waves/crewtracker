# CrewTracker

Web app (Next.js 16 + Supabase + Vercel) for production managers running corporate AV shows. Tracks crew time and calculates payroll — day rates, overtime, double time, meal penalties, short turnarounds, travel pay, half-day pay. The PM enters punch times on-site; the app does the math and generates reports (on-screen, PDF, CSV).

This is a migration from a native SwiftUI/SwiftData iPhone app (v1.3, shipped to TestFlight, no longer actively developed — all new feature work happens here). The iOS app remains the reference implementation for payroll business logic; `lib/payroll.ts` is a line-by-line-verified port of its `PayrollCalculator` struct.

Dan (the developer) has no professional dev background. Claude writes the code; work now happens directly in this repo via Claude Code (file read/write + git access) rather than pasting file contents back and forth.

## Tech stack

- Next.js 16.2.10 (Turbopack, App Router), TypeScript, React 19
- Supabase (PostgreSQL + RLS + Auth)
- Tailwind CSS
- `@react-pdf/renderer` for PDF export
- Hosting: Vercel (Hobby plan, 100 deploys/day)

## Live URLs

- Production: https://crewtracker-lime.vercel.app
- GitHub: Wood-and-Waves/crewtracker
- Supabase project ref: `nfrvxkwemtittrqboebl`

## How we work

- Read the actual current file before editing it — never guess at existing code.
- Complete file replacements are preferred over fragile multi-point patches when a change touches many interdependent spots in one file.
- Always run `npm run build` before considering a change complete; fix errors before moving on.
- Commit messages: clear, one line (e.g. `Fix invite RLS: move org invite creation to server-side admin API route.`).
- Dan prefers concise, list-based responses during active coding — ask only when a real decision is needed.
- When setting up multi-step infrastructure (auth, tooling, etc.), Dan prefers going one step at a time and confirming each works before moving to the next, rather than being handed a full checklist up front.
- Surface errors instead of failing silently. This has bitten the project before: RLS gaps that silently blocked saves, updates that "didn't take" with no visible error.
- If a new table is added, don't assume RLS policies exist — check `pg_policies` before assuming a feature "should just work." The schema was originally built SELECT-only in several places and INSERT/UPDATE/DELETE policies had to be retrofitted per table as features hit walls.

## Local tooling (set up — use it, don't ask Dan to paste things)

- **git push** works directly from here — credentials are cached via `git config credential.helper store`. No need to hand commits to Dan for GitHub Desktop anymore.
- **Direct SQL access**: `DATABASE_URL` is in `.env.local` (Supabase "Transaction pooler" connection string — the "Direct connection" host is IPv6-only and won't resolve here). Run SQL files with `npm run db:sql -- path/to/file.sql` (wraps `scripts/run-sql.mjs`, a thin `pg` client). Use this for RLS policies, schema migrations, one-off data checks — no more handing Dan copy-paste SQL for the Supabase SQL Editor.
- **Vercel CLI**: `npx vercel inspect crewtracker-lime.vercel.app` / `npx vercel ls crewtracker` to check deployment status and build info directly after a push, instead of guessing whether a deploy succeeded.

## Design system — "Signal" (redesigned 2026-07-14/15)

The app was fully redesigned from the original pure-black/zinc/iOS-blue look to a direction called **Signal**: near-true-black (light theme also fully supported, both first-class), bold white headers, the brand's electric blue as the sole accent, no glow effects (tried in an early mockup round, Dan rejected it — use a crisp `ring-1 ring-inset ring-accent` instead), minimal monospace (tried "everywhere," Dan found it too techy — reserve mono for places digits must align in columns).

**Everything is token-driven — never hardcode a color.** Tokens live in `app/globals.css` as CSS variables (`--bg`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--line`, `--accent`, `--accent-ink`, `--accent-wash`, `--ot`, `--good`, `--danger`, `--radius*`), mapped into Tailwind v4's `@theme inline` so they're usable as ordinary utilities: `bg-surface`, `text-ink`, `text-muted`, `border-line`, `text-accent`, `rounded-card`, `rounded-field`, `rounded-pill`. Light values are the `:root` default (media-query fallback via `prefers-color-scheme: dark` for the dark values); an explicit `data-theme="light"|"dark"` on `<html>` (set by `components/ui/ThemeToggle.tsx`, persisted to `localStorage['ct-theme']`, applied pre-paint by `components/ThemeScript.tsx` to avoid a flash) overrides the media query in both directions. **If you introduce a new color, add it as a token in globals.css, not as a one-off Tailwind class** — that's the whole point of the system Dan asked for, so future restyles are a one-file edit.

**Reusable primitives** in `components/ui/`: `Button` (variants: primary/ghost/danger), `Card`, `Chip` (tones: neutral/live/ot/good/danger — semantic status color, kept separate from the brand accent), `Toggle` (on/off switch, replaces native checkboxes everywhere), `ThemeToggle`. Compose new UI from these rather than writing raw styled `<button>`/`<div>` markup.

**Responsive nav, not just responsive layout:**
- **≥1024px** (landscape iPad + desktop): `AppShell.tsx` renders a sticky **top nav bar** (logo, Shows/Directory/Settings links, theme toggle) — a mouse-driven desktop experience, not a shrunk sidebar.
- **<1024px** (portrait iPad + phone): top nav hides, a **fixed bottom tab-bar** (`position: fixed`, stays pinned while content scrolls) takes over — an app-like phone experience.
- **Desktop screens restructure, they don't just stretch mobile layouts.** Directory becomes a real data table with search on desktop, collapsing to tappable rows below 1024px. Settings goes two-column (Personal + Org side by side, AV Roles full-width) on desktop. Same principle applies to any future screen that feels sparse when simply widened.
- Any screen with a floating fixed-position action button (e.g. Edit Show's "Save Changes" pill) must clear the bottom tab-bar's position below 1024px — use an offset like `bottom-24 lg:bottom-6`, don't let two fixed-bottom elements collide.

**The tracker console's punch table** (`TimecardRow.tsx` + the room block in `shows/[id]/page.tsx`) is a genuine ruled grid on desktop (`lg:grid-cols-[...]`, shared between the header row and every crew row via `lib/trackerLayout.ts`), collapsing to labeled per-field cards on mobile. This replaced free-floating pill buttons after Dan's first-round feedback that times weren't visually separated.

**Known Safari gotcha:** native `<select>` elements need explicit `className="bg-surface-2 text-ink"` (token equivalents of the old zinc classes) on every `<option>`, or text is invisible against the dark background in Safari. iPad Safari also has a hydration bug that can duplicate `<option>` elements in a controlled `<select>` — fix is a `key` prop on the `<select>` tied to a stable identifier of the options list (e.g. `key={options.map(o => o.id).join(',')}`) so React remounts instead of patching in place. Apply this pattern to any new dropdown.

**Logo:** `components/Logo.tsx` now renders the **real** CrewTracker mark (dropped in 2026-07-15) — two fixed blue tones (`#6699FF` / `#3366CC`), not `currentColor`, so it's already designed to sit on both light and dark backgrounds as-is rather than needing theme-aware recoloring. It has no intrinsic width/height (the source SVG has no `width`/`height` attrs, just a `viewBox`), so the component defaults to `w-7 h-7` internally and every call site should pass `className` to override when a different size is needed (login/invite use `w-12 h-12`) — **don't render `<Logo />` bare**, it'll fall back to the browser's oversized default if the default class is ever removed. `app/icon.png` and `app/favicon.ico` are also the real assets now (Next's file-based icon convention — no manual `<link>` tags needed). A duplicate lives at `public/app-icon.png` purely so the marketing page can reference it via a normal `<img>`/`next/image` src, since `app/icon.png` isn't reliably a stable public URL.

## File structure

```
app/
  page.tsx                     — public marketing landing page (logged-in visitors redirect straight to /dashboard); styles scoped via page.module.css so they can't leak into the app
  icon.png / favicon.ico       — real app icons (Next's file-based convention, auto-wired)
  auth/callback/route.ts       — OAuth callback; also finalizes invite acceptance
  dashboard/
    layout.tsx                 — wraps dashboard pages in AppShell
    page.tsx                   — shows dashboard (list + New Show modal); onboarding fallback if no org
    directory/page.tsx         — Crew Directory list
    directory/[crewId]/page.tsx — Edit Crew Member
    shows/[id]/page.tsx        — Show workspace: day nav, room columns, tracker console
    shows/[id]/edit/page.tsx   — Edit Show: info, timezone, financials toggle, full payroll ruleset
    shows/[id]/reports/page.tsx — By Day / By Crew, Master Summary, CSV/PDF export
    settings/page.tsx           — personal prefs, org settings, AV Roles editor
  api/
    admin/create-invite/route.ts — server-side invite creation (service role, bypasses RLS)
    invite/accept/route.ts       — finalizes invite acceptance for password sign-in path
  invite/[token]/page.tsx      — invite landing page
  invite/[token]/InviteAuthForm.tsx — client auth form for invite flow
  login/page.tsx               — Google SSO + email/password + magic link + forgot-password link
  auth/reset-password/page.tsx — sets a new password after a recovery-link redirect
  superadmin/page.tsx          — super admin panel
  superadmin/invite-org/page.tsx — generate new org invite links
components/
  AppShell.tsx                 — responsive top-nav (>=1024px) / fixed bottom tab-bar (<1024px)
  Logo.tsx                      — placeholder brand mark, isolated for an easy future swap
  ThemeScript.tsx               — inline pre-paint script, applies saved light/dark theme with no flash
  ui/                           — Signal design-system primitives: Button, Card, Chip, Toggle, ThemeToggle
  NewShowModal.tsx              — create show, auto-generates work_days
  AddRoomModal.tsx               — add room to a work day (optionally all remaining days); blocks duplicate room names on the same day
  RoomActionsMenu.tsx            — rename/delete a room (per-day, matches the room model)
  StaffRoomModal.tsx             — bulk staff crew into a room ("apply to all remaining days" defaults checked)
  TimecardRow.tsx / TimeEntryModal.tsx — punch rows + manual time entry w/ chronology validation; TimecardRow renders as a ruled grid row on desktop, a labeled card on mobile
  BatchPunchBar.tsx              — room-level batch punch actions
  CrewDirectoryClient.tsx / EditCrewMemberClient.tsx — Directory goes to a real data table on desktop
  EditShowClient.tsx             — all Edit Show fields batched into one Save button; Crew & Rates $ display respects Shoulder Surfer Mode; two-column on desktop
  ExportCSVButton.tsx / ExportPDFButton.tsx — gated by financials permission
  ArchiveShowButton.tsx / PersonalSettingsClient.tsx / OrgSettingsClient.tsx / AVRolesEditor.tsx — Settings goes two-column on desktop
lib/
  supabase/client.ts / server.ts / admin.ts
  payroll.ts    — TypeScript port of iOS PayrollCalculator
  punches.ts    — punch ordering/labels + chronology validation; formatPunchTime takes a use24Hour flag
  invite.ts     — acceptInvite(): finalizes invite, seeds default av_roles for new orgs
  trackerLayout.ts — shared grid template for the tracker console punch table (kept out of a 'use client' file on purpose, see Past incidents)
  cn.ts         — tiny classnames-joiner helper used across the ui/ primitives
proxy.ts        — auth middleware (protects all routes except /login, /auth/*, /invite/*, and exactly "/")
scripts/
  run-sql.mjs   — runs a .sql file against DATABASE_URL (npm run db:sql -- file.sql)
  sql/          — one-off SQL scripts kept for reference (RLS policies, migrations, checks)
```

## Database schema

- `organizations` — id, name, created_at, timecard_rounding_minutes (default 1 = exact minute; 15/30 also valid), default_cc_email (nullable, unused until email delivery is built). Has an UPDATE policy gated to `can_manage_users`.
- `profiles` — id (= auth.uid), organization_id, full_name, email, base_role, use_24_hour_time (bool), shoulder_surfer_mode (bool), + permission booleans
- `subscriptions` — one per org, auto-created via `handle_new_organization()` trigger
- `invitations` — token-based invites; `token`/`expires_at` have DB defaults
- `shows` — id, organization_id, name, venue, start_date, end_date, timezone_identifier (default America/Chicago), archived (bool, no UI yet), client_company, job_number, show_notes, show_financials (bool, gates $ visibility), created_by
- `show_assignments` — links users to specific shows
- `payroll_rulesets` — one per show; fields match iOS `PayrollRuleset` exactly
- `work_days` — id, show_id, date, day_number
- `rooms` — id, work_day_id, name (scoped to a day, not persistent across the show). Has full SELECT/INSERT/UPDATE/DELETE policies (UPDATE/DELETE added when room rename/delete UI was built).
- `timecards` — id, room_id, crew_member_id, crew_member_name, role, day_rate, is_travel_day, travel_in_day, travel_out_day, pay_as_half_day
- `punches` — id, timecard_id, punch_type (`start|meal_out|meal_in|meal2_out|meal2_in|end`), punched_at
- `crew_members` — id, organization_id, full_name, email, phone, notes
- `rate_cards` — id, crew_member_id, role, day_rate
- `av_roles` — id, organization_id, name, sort_order, created_at — per-org job title list, auto-seeded with 13 defaults on org creation (guarded against duplicate seeding — this broke once, see below)

Helper functions: `my_organization_id()`, `can_see_all_shows()`.
Triggers: `on_auth_user_created → handle_new_user()` (had a `search_path` bug that broke all signups — needs `SET search_path = public`), `on_organization_created → handle_new_organization()`.

## Permissions system

Two-layer model on `profiles`: `base_role` (admin/staff/pm/crew preset) + individual boolean toggles, customizable per user by an admin. Financial visibility in reports/exports requires **both** `show.show_financials` (does this show track $ at all) **and** `profile.can_view_pay_rates` (is this user allowed to see pay rates).

Permission columns: `can_manage_users`, `can_manage_billing` (hidden), `can_manage_crew_directory`, `can_import_crew`, `can_view_crew_contacts` (hidden), `can_create_shows`, `can_edit_all_shows`, `can_archive_shows`, `can_duplicate_shows` (hidden), `can_edit_timecards`, `can_approve_timecards` (hidden), `can_view_pay_rates`, `can_edit_pay_rates`, `can_manage_rulesets`, `can_view_reports`, `can_export_reports`, `can_send_reports`, `view_only`.

## Payroll business logic (`lib/payroll.ts`)

- Day rate base: hourly = `dayRate / overtimeAfterHours`. Crew always get at least their full day rate (minimum guarantee).
- OT/DT thresholds configurable per show ruleset (default OT after 10hr @1.5x, DT optional after 12hr @2x).
- Meal breaks: under `minimum_meal_break_minutes` (default 60) = no deduction; over that, deduct up to `meal_break_deduction_cap` (default 60).
- Meal penalties: triggered after `meal_penalty_grace_period` (default 6hr) without a break; max 2/day.
- Short turnaround: rest between shifts < `short_turn_rest_hours` (default 10hr) → next day is all DT, with a minimum-guarantee floor. Detection needs the **whole show's** timecards (not just current room/day) to find a crew member's previous day's end punch across rooms/days.
- Travel hybrid days: `travel_in_day`/`travel_out_day` are additive to that day's worked hours (crew can travel in AND work a full day). Plain `is_travel_day` (no work) is a separate state.
- Pay As Half Day: manual PM toggle, only shown for ≤5hr days — not automatic, since it's a negotiated/contractual call.
- **Worked vs Paid**: Worked = raw hours actually clocked. Paid = per-day ceiling-rounded hours (each day's net hours rounded up before summing across days) — this is what's billed. Example: 0.25hr OT Monday + 0.25hr OT Tuesday = 2hr billable OT, not 0.5hr. Validated against a real client payroll spreadsheet.
- Display convention: on-screen By Day/By Crew reports show raw **Worked** hours; Master Summary totals and PDF/CSV show **Paid** (ceiling-rounded); PDF/CSV show both explicitly.
- Timecard rounding is org-wide (`organizations.timecard_rounding_minutes`, set on the Settings page), unlike iOS's per-device `timeRounding` UserDefaults toggle. Every payroll function that calls `calculateNetHours` takes a `roundingMinutes` param (default 1 = exact minute); every call site across the app threads the org's value through explicitly. If you add a new call site, don't let it silently fall back to the default — fetch and pass the real value.

## Known gaps / not yet built

- **Admin UI for user privileges** — the backend exists (`profiles.base_role` + the full set of `can_*` permission booleans, see Permissions system above), but there's no screen for an admin to actually edit another user's role/permissions. `can_manage_users` currently only gates org-wide Settings fields (name, rounding); it doesn't unlock a per-user editor yet. Needs a UI (likely on the Settings page or a new Directory-adjacent screen) listing org members with role/permission toggles, gated by `can_manage_users`, writing to `profiles` for users in the same `organization_id`.
- SMS/text timesheet delivery is explicitly **not** being built — decided against a web texting service (Twilio, etc.); device-native share/SMS (e.g. `sms:` links or the OS share sheet) is the intended path, matching how iOS did it natively.
- **Email report delivery via Resend** — planned, not yet wired up. `organizations.default_cc_email` already exists in schema for this, just unused. Will need a Resend API key/env var and a send path (likely a server route, similar pattern to `api/admin/create-invite`).
- **"Join the Beta" interest form** — the landing page's "Get Started" CTA currently points at `/login`; it should instead go to a new interest-form page/route titled "Join the Beta" (rename the CTA label too). The form asks something like "Are you interested in joining the CrewTracker Beta?" plus qualifying questions (team size, number of admin users needed, and similar — current company/role, expected show volume/month, and how they heard about it are reasonable additions). On submit it emails Dan (via Resend, once wired up) rather than writing to the database — this is the interest-capture funnel ahead of any self-serve signup, not a replacement for the superadmin-invite onboarding path.
- **Stripe billing** — planned (was previously listed as indefinitely deferred). `can_manage_billing` permission column and `subscriptions` table already exist as placeholders; actual Stripe integration (checkout, webhooks, plan gating) not started.
- **No-show / cancelled day flag** — need a per-crew-member, per-day flag (alongside the existing `is_travel_day` / `pay_as_half_day` style toggles on `timecards`) to mark a day as a no-show or cancellation, distinct from a day with punches. Affects payroll (likely $0/no hours counted) and probably short-turnaround detection (a flagged day likely shouldn't count as the "previous day" for rest-period math) — needs a design pass against the iOS reference behavior (if any) before implementing.
- Microsoft/Azure SSO, Capacitor iOS/Android wrapping — still deferred
- Crew app access (crew role) — schema ready, UI deferred
- Room delete/rename, show archiving, and the Settings page (24-hour time, Shoulder Surfer Mode, org-wide timecard rounding, default CC email, AV Roles editor) are all built — see File structure above.
- Superadmin pages (`app/superadmin/*`) were **not** included in the Signal redesign pass — still on the old zinc palette. Low priority (Dan-only, rarely used), but convert them to tokens if you're ever in that file.
- No public self-serve signup — new orgs are onboarded only via superadmin-generated invite links; that stays true even after the "Join the Beta" form ships (the form is a lead-capture funnel, not an auto-provisioning flow).

## Past incidents worth remembering

- Invite-seeding logic once fired twice for one org, creating duplicate `av_roles` rows — surfaced as doubled dropdown options on iPad Safari. Fixed via SQL cleanup + guarding on `existingRoleCount` before seeding.
- `TimeEntryModal` used to default new punches to the browser's real-world "today" instead of the show-day being viewed — silently produced a 33.5-hour day and broke short-turnaround detection. Fixed (see [components/TimeEntryModal.tsx](components/TimeEntryModal.tsx)).
- Same bug, different spot: the tracker console picked "today" via `new Date().toISOString()` (UTC), which rolls to tomorrow's date in the evening in any US timezone — opened the wrong day by default. Fixed by computing today's date via `Intl.DateTimeFormat('en-CA', { timeZone })`. **Any "what day is it" logic in this app must derive from the show's timezone, never from UTC or raw `Date()` — this class of bug has now recurred twice.**
- `AddRoomModal` had zero uniqueness check, so the same room name could be added twice to one day. Fixed by checking existing room names (case-insensitive, per work_day_id) before inserting.
- `totalPay` initially miscalculated by multiplying straight-time hourly instead of using the flat day-rate guarantee — corrected against the real Swift source.
- RLS was originally SELECT-only on most tables; INSERT/UPDATE/DELETE policies were retrofitted per table as each feature hit a wall. **Do not assume a new table has full RLS coverage.**
- A plain string constant (`PUNCH_GRID_COLS`, the shared grid template for the tracker console) was exported from `TimecardRow.tsx`, a `'use client'` file, and imported into the server-rendered `shows/[id]/page.tsx`. Next.js can't safely pass non-component named exports across that client/server boundary — it silently serialized the constant into a broken function reference instead of the string, so the header row rendered with no `grid-template-columns` at all (looked like a total layout collapse, not an obvious "undefined" error). Fixed by moving the constant to a plain file with no `'use client'` directive (`lib/trackerLayout.ts`). **Never export non-component values from a `'use client'` file for a Server Component to import — put shared constants in a plain module instead.**
- During the Signal redesign, one push (Edit Show conversion) deployed to production with `x-vercel-cache: MISS` on every request yet kept serving the *old* component markup, even though the source on GitHub was confirmed correct via `git show origin/main`. This wasn't edge/CDN caching (verified via response headers) — it looked like a stale Vercel **build** cache serving an old compiled artifact for that one route. Fixed with `npx vercel --prod --force` (skips the build cache, full clean rebuild). **If a deploy status shows "Ready" and the source is confirmed correct but the live site still shows old UI, don't assume it's browser cache — verify with a `fetch(url, {cache:'no-store'})` from the browser console (or `curl`) to see what's actually being served, and if it's genuinely stale server-side output, force a clean rebuild rather than re-pushing trivial commits and hoping.**
- `Logo.tsx`'s SVG has no `width`/`height` attributes (Illustrator export, just a `viewBox`). The first version of the landing page + login/invite screens rendered it with no sizing class at all, so it fell back to the browser's default SVG box — looked fine in dev screenshots taken mid-flow but showed up huge on `/login`. Fixed by giving the component a default `w-7 h-7` internally rather than trusting every call site to remember to size it. **Any raw `<svg>` without intrinsic dimensions needs either an explicit size or a safe default baked into the component — don't rely on callers.**
- The landing page's hero icon (`next/image`) didn't center under `text-align: center` on its parent — `next/image` renders as a block-level element, and `text-align` only affects inline/inline-block content. Fixed with `display: block; margin: 0 auto;` directly on the image. **`text-align: center` silently does nothing for block-level images/components — center those with margin auto or flex, not text-align.**
- A security fix scoped `show_assignments`' SELECT policy by making it query `shows` — but `shows`' own SELECT policy already queries `show_assignments`, and Postgres refuses to evaluate that circular RLS reference at all (`infinite recursion detected in policy for relation "shows"`), which broke show creation and viewing entirely. Two attempts to fix it via a `SECURITY DEFINER` helper function (first plain SQL, then PL/pgSQL, to rule out planner inlining) both still recursed — **Postgres's RLS recursion guard is structural and per-relation, and does not care about function wrapping, language, or security-definer bypass semantics; two tables whose policies reference each other will recurse no matter how the reference is indirected.** The real fix was to denormalize `organization_id` directly onto `show_assignments` (populated by a `BEFORE INSERT` trigger) so its policy never needs to touch `shows` at all. **Never write two tables' RLS policies that reference each other, even indirectly through a function — break the cycle by denormalizing the key one side needs, not by hiding the reference.** Also: `show_assignments` currently has no INSERT/UPDATE/DELETE policy at all (SELECT-only) — the usual retrofit-as-needed gap in this schema; the next feature that writes to it needs to add one, and should keep the new `organization_id` column and its trigger in mind.
- SQL verification via `scripts/run-sql.mjs`/`DATABASE_URL` connects as a role that bypasses RLS entirely (needed for admin/service-role work) — it can confirm a policy's *text* is as intended, but it can never catch a real RLS enforcement bug (like the recursion above), since that connection never actually enforces RLS. **Real RLS verification requires either a genuine authenticated app/browser session, or a direct REST call using the public anon key** (as used to confirm the `invitations` table leak was actually exploitable, and later actually fixed).

## Environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, never expose to browser) — in `.env.local` and Vercel project settings. `RESEND_API_KEY` (beta-signup email). `CRON_SECRET` (Vercel-only, not in `.env.local` — locks down the keepalive cron endpoint; see Notes).

## Notes

- Supabase free tier pauses projects after 7 days of inactivity. A **keepalive cron** guards against this: `vercel.json` schedules a daily Vercel Cron (08:00 UTC) that hits `app/api/keepalive/route.ts`, which runs one trivial `select` against Supabase — that query counts as DB activity and resets the 7-day timer. The route is allowlisted in `proxy.ts` (otherwise the auth middleware redirects the cron to `/login`) and gated by the optional `CRON_SECRET` env var (Vercel Cron sends it as a `Bearer` header; unauthenticated hits get `401`). If it ever pauses anyway (broken deploy, disabled cron), just unpause from the dashboard. Note: Vercel Hobby crons run at most once/day, which is why the schedule is daily, not more frequent.
- `crewtracker-lime.vercel.app` is the stable production URL; deployment-specific preview URLs are not.
