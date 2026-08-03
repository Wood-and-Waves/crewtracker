# CrewTracker

Web app (Next.js 16 + Supabase + Vercel) for production managers running corporate AV shows. Tracks crew time and calculates payroll — day rates, overtime, double time, meal penalties, short turnarounds, travel pay, half-day pay. The PM enters punch times on-site; the app does the math and generates reports (on-screen, PDF, CSV).

This began as a migration from a native SwiftUI/SwiftData iPhone app (v1.3, shipped to TestFlight, now frozen — not developed further).

**iOS is the reference for `lib/payroll.ts` and nothing else.** That file is a line-by-line-verified port of the Swift `PayrollCalculator` struct, and changes to the payroll *math* should still be checked against the Swift source. It is **not** a product roadmap or a design authority. The web app has deliberately moved past it — Final Report email and show locking, payroll presets, show-wide day rates, the permissions model, multi-user orgs, org-wide rounding, dollar-free crew timesheets — none of which exist in iOS. "iOS doesn't do it that way" is not a reason to reject a design, and "iOS doesn't have it" is never a reason not to build something.

Dan (the developer) has no professional dev background — so explain the *why* in plain language, skip unexplained jargon, and lead with a recommendation rather than a menu of options. Claude writes the code, working directly in this repo via Claude Code (file read/write, git, SQL).

## Tech stack

- Next.js 16.2.10 (Turbopack, App Router), TypeScript, React 19
- Supabase (PostgreSQL + RLS + Auth)
- Tailwind CSS
- `@react-pdf/renderer` for PDF export
- Hosting: Vercel (Hobby plan, 100 deploys/day)

## Live URLs

- Production: https://crewtracker.app (primary public domain; `www.` 308-redirects to apex). `crewtracker-lime.vercel.app` is the underlying stable Vercel origin — still valid, and used by the keepalive check and `vercel inspect`/CLI.
- GitHub: Wood-and-Waves/crewtracker
- Supabase project ref: `nfrvxkwemtittrqboebl`

## How we work

- Read the actual current file before editing it — never guess at existing code.
- **Prefer targeted edits over whole-file rewrites.** A rewrite turns a three-line change into an unreadable diff, forces every unrelated line to be reproduced from memory (which is how code gets silently dropped), and throws away the way a targeted edit *fails loudly* when the text doesn't match — the main defence against acting on a stale read, which Dropbox sync has caused in this repo before. Rewrite a whole file only when genuinely restructuring it.
- Always run `npm run build` before considering a change complete; fix errors before moving on.
- Commit messages: clear, one line (e.g. `Fix invite RLS: move org invite creation to server-side admin API route.`).
- Concise, list-based responses during **active coding**. Design and trade-off conversations are the opposite: they want prose and reasoning, not a terse menu of options. When Dan is choosing a direction, explain the choices in plain language and say which one you recommend and why — a list of jargon-labelled options is not a substitute for an explanation. Ask only when a real decision is needed; make routine calls yourself.
- When setting up multi-step infrastructure (auth, tooling, etc.), Dan prefers going one step at a time and confirming each works before moving to the next, rather than being handed a full checklist up front.
- Surface errors instead of failing silently. This has bitten the project before: RLS gaps that silently blocked saves, updates that "didn't take" with no visible error.
- If a new table is added, don't assume RLS policies exist — check `pg_policies` before assuming a feature "should just work." The schema was originally built SELECT-only in several places and INSERT/UPDATE/DELETE policies had to be retrofitted per table as features hit walls.

## Local tooling (set up — use it, don't ask Dan to paste things)

- **git push** works directly from here — credentials are cached via `git config credential.helper store`. No need to hand commits to Dan for GitHub Desktop anymore.
- **Two databases. `.env.local` points the app and the SQL tools at DEV by default.**
  - **Production** — Supabase project `nfrvxkwemtittrqboebl`, owned by Dan's Wood-and-Waves login. What Vercel serves. Real customers eventually.
  - **Development** — project `oeflzwgtrkgjuvjdcwnv` (`crewtracker-dev`), owned by a *separate* Supabase login because the free-project limit is per account, not per organization. Built from `scripts/sql/schema.sql` and filled by `npm run db:seed`. Holds generated fake data only — never a copy of production, so real crew names, phones and rates can't land here.
- **Direct SQL access**: `npm run db:sql -- path/to/file.sql` runs against **dev**. Production requires an explicit flag: `npm run db:sql -- --prod path/to/file.sql`, which prints a `⚠ PRODUCTION` banner with the project ref first. Every run names the database it connected to, so the target is never something to infer from context. (Wraps `scripts/run-sql.mjs`, a thin `pg` client; `DATABASE_URL`/`DATABASE_URL_PROD` are Supabase "Transaction pooler" strings — the "Direct connection" host is IPv6-only and won't resolve here.)
- **Backups stay pinned to production** regardless of where the app points: `npm run db:dump` / `npm run db:schema` read `DATABASE_URL_SESSION_PROD`. Both print which project they dumped.
- **Env var convention: unsuffixed is DEV, `_PROD` is production.** `DATABASE_URL` / `DATABASE_URL_SESSION` are dev (transaction and session poolers); `DATABASE_URL_PROD` / `DATABASE_URL_SESSION_PROD` are production. Anything touching production takes an explicit `--prod`.
- **Schema changes go through migrations — `npm run db:migrate`.** Numbered files in `scripts/sql/migrations/` are applied in filename order, exactly once per database, each in a transaction, recorded in a `schema_migrations` table with a checksum. `--status` lists applied and pending; `--prod` targets production; `--baseline` records files as applied without running them (only ever right after building a database from `schema.sql`, which already contains them). **Editing an applied migration is refused** — the database still holds what the original did, so a new migration is the only honest fix. Write dev first, verify, then run `--prod`.
- **Rebuilding a database from scratch takes four steps, and `schema.sql` is only one of them.** Create the project with *"Automatically expose new tables" OFF*, then apply `schema.sql`, `out-of-schema.sql`, and `grants.sql` in that order. Two things `pg_dump --schema=public` structurally cannot capture, both of which fail **silently** — the restore reports no errors and the database simply stops enforcing something:
  - **Triggers anchored outside `public`**, even where the function they call is in `public` and dumps fine. `ensure_rls` (force-enables RLS on every new table) and `on_auth_user_created` (creates the `profiles` row for a new login) are both this shape. Without the second, signing up produces a login with no profile. Both live in `scripts/sql/out-of-schema.sql`.
  - **Revoked privileges.** `pg_dump` emits GRANTs computed against Postgres's built-in default, so a REVOKE is an *absence* — and on Supabase an absence is inherited from `ALTER DEFAULT PRIVILEGES` rather than removed. The `day_rate` lockdown is written as an absence, so without `grants.sql` it silently doesn't exist in the rebuilt database. `npm run db:grants` regenerates it from production; re-run after changing any privilege.

  Verified 2026-07-26 to reproduce production exactly: 15 tables, 43 policies, 17 functions, 12 public + 6 non-public triggers, 2 views, 23 indexes, 47 constraints, 7 event triggers, 208 table grants, 1390 column privileges.
- **Dev browser sign-in**: `app/api/dev/login/route.ts` mints a session so a browser can be signed in for UI verification. Three independent gates — `NODE_ENV` must be development (Vercel builds everything, preview included, as production), the Supabase project must not be production, and `DEV_LOGIN_SECRET` from `.env.local` must match. Every rejection is a bare 404.
- **Vercel CLI**: `npx vercel inspect crewtracker-lime.vercel.app` / `npx vercel ls crewtracker` to check deployment status and build info directly after a push, instead of guessing whether a deploy succeeded.

## Design system — "Signal" (redesigned 2026-07-14/15)

**2026-07-28 — cards are being retired.** Dan: *"I think I am about done with the 'cards' design. It is just too clunky with the cards of all different sizes."*

Read that literally: what is being killed is **several boxes side by side that are never the same height** — a grid of cards, each with its own edge, raggedly bottomed against its neighbour. It is the *plural* that was clunky, not the border. The replacement inside a screen is **ruled sections**: small-caps headings, hairline rules, content at full width, rows label-left / control-right with a `border-b border-line` between them.

**One container per screen stays — it is the house pattern, not a leftover.** Every top-nav destination (Shows, Schedule, Directory, Team, Settings) puts its content inside a single `rounded-card border border-line bg-surface`, and that container is what gives a page its edge. **Do not strip these off in the name of the card retirement.** An earlier version of this section said "nothing in a box" and that the wrapper-around-a-whole-screen use was the thing going — that was wrong, and it described no screen that ever shipped. Settings was the one page missing its container and read as unfinished beside the other four; it was brought into line 2026-07-29, along with its `<h1>`, which was `text-2xl font-bold` where the others are `text-3xl font-extrabold tracking-tight`.

**Where a screen repeats a unit, each unit is its own panel.** A screen with one table boxes the table; a screen with N tables boxes each one, because the alternative — a single container swallowing all of them — weakens exactly the boundary that matters. The tracker does this per **room** (a room has its own name, ⋮ menu and batch bar, and punching someone into the wrong room is a live error), and Reports does it per **work day** in By Day and per **person** in By Crew. Both were brought into line 2026-07-29.

This does not reintroduce what Dan disliked, because these units stack one per row at full width — nothing sits beside anything, so nothing can be ragged. Two practical notes from doing it: the horizontal inset goes on the **bands inside** the panel, never on the panel itself, so each band's `border-b` still runs edge to edge instead of stopping short on both sides; and the room panel deliberately has **no `overflow-hidden`**, because `RoomActionsMenu` opens a dropdown out of it and clipping would cut the menu off.

What stays outside on the page background is the page header, any whole-screen summary (the tracker's stat strip, Reports' Master Summary) and the view controls (tabs, the All Rooms batch bar) — summaries and controls sit above the content; the content is what gets edges.

Converted so far: the **shows list** (a real table), **New Show** (a full page), the **tracker** (header strip instead of a left rail, one line per crew member), **Settings** (a left nav, one section at a time), and **Reports** (Master Summary as an inline stat strip, By Day and By Crew as one shared ruled table). Still on cards: the admin screens (Team, Edit Crew, Edit Show). `components/ui/Card` still exists and is still correct for a genuinely raised surface *inside* a section — what it must not become again is a grid of them.

**No fixed-position dialogs for editing.** An editor that covers the thing you are editing is the pattern being removed. Cell editors, pickers and the payroll-preset editor all open **in place, below** what they belong to. `fixed inset-0` overlays remain fine for genuine confirmations.

**Terminology: it is a POSITION, never a "call".** In this industry a call is a TIME ("call is 8am"), so using it for a list of required roles collides every time. The database table is still `crew_call_positions` and the components are still `CrewCall*` — renaming those is a migration for no user-visible gain — but **every user-facing string says positions**.

The app was fully redesigned from the original pure-black/zinc/iOS-blue look to a direction called **Signal**: near-true-black (light theme also fully supported, both first-class), bold white headers, the brand's electric blue as the sole accent, no glow effects (tried in an early mockup round, Dan rejected it — use a crisp `ring-1 ring-inset ring-accent` instead), minimal monospace (tried "everywhere," Dan found it too techy — reserve mono for places digits must align in columns).

**Everything is token-driven — never hardcode a color.** Tokens live in `app/globals.css` as CSS variables (`--bg`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--line`, `--accent`, `--accent-ink`, `--accent-wash`, `--ot`, `--good`, `--danger`, `--radius*`), mapped into Tailwind v4's `@theme inline` so they're usable as ordinary utilities: `bg-surface`, `text-ink`, `text-muted`, `border-line`, `text-accent`, `rounded-card`, `rounded-field`, `rounded-pill`. Light values are the `:root` default (media-query fallback via `prefers-color-scheme: dark` for the dark values); an explicit `data-theme="light"|"dark"` on `<html>` (set by `components/ui/ThemeToggle.tsx`, persisted to `localStorage['ct-theme']`, applied pre-paint by `components/ThemeScript.tsx` to avoid a flash) overrides the media query in both directions. **If you introduce a new color, add it as a token in globals.css, not as a one-off Tailwind class** — that's the whole point of the system Dan asked for, so future restyles are a one-file edit.

**Reusable primitives** in `components/ui/`: `Button` (variants: primary/ghost/danger), `Card`, `Chip` (tones: neutral/live/ot/good/danger — semantic status color, kept separate from the brand accent), `Toggle` (on/off switch, replaces native checkboxes everywhere), `ThemeToggle`, `Dropdown`, `AccountMenu`. Compose new UI from these rather than writing raw styled `<button>`/`<div>` markup.

**One deliberate exception to the token rule:** `lib/reportPdf.tsx` uses literal hex colors. `@react-pdf/renderer` renders outside the browser, so CSS variables don't exist there, and a PDF is a fixed document with no light/dark mode to respond to. Don't "fix" it into tokens.

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
  join-beta/page.tsx           — "Join the Beta" interest form (emails Dan via Resend, writes nothing to the DB)
  auth/callback/route.ts       — OAuth callback; also finalizes invite acceptance
  auth/reset-password/page.tsx — sets a new password after a recovery-link redirect
  dashboard/
    layout.tsx                 — wraps dashboard pages in AppShell
    page.tsx                   — shows dashboard (list + New Show modal); onboarding fallback if no org
    directory/page.tsx         — Crew Directory list
    directory/[crewId]/page.tsx — Edit Crew Member
    team/page.tsx              — org member list (admin)
    team/[userId]/page.tsx     — per-user role + permission editor, gated on can_manage_users
    shows/[id]/page.tsx        — Show workspace: day nav, room columns, tracker console
    shows/[id]/edit/page.tsx   — Edit Show: info, timezone, financials toggle, full payroll ruleset
    shows/[id]/reports/page.tsx — By Day / By Crew, Master Summary, CSV/PDF export, Send Hours, Final Report
    shows/new/page.tsx          — create a show: details, payroll preset, and the rooms×days positions grid
    schedule/page.tsx           — company-wide calendar across shows
    settings/page.tsx           — personal prefs, org settings, AV Roles editor, payroll presets
  api/
    admin/create-invite/route.ts — server-side invite creation (service role, bypasses RLS)
    invite/accept/route.ts       — finalizes invite acceptance for password sign-in path
    beta-signup/route.ts         — Join the Beta form submissions -> Resend
    reports/final/route.ts       — Final Report: renders CSV+PDF server-side, emails admin-designated recipients, locks the show
    keepalive/route.ts           — daily cron ping so Supabase's free tier doesn't pause (see Notes)
  invite/[token]/page.tsx      — invite landing page
  invite/[token]/InviteAuthForm.tsx — client auth form for invite flow
  login/page.tsx               — Google SSO + email/password + magic link + forgot-password link
  superadmin/page.tsx          — super admin panel
  superadmin/invite-org/page.tsx — generate new org invite links
components/
  AppShell.tsx                 — responsive top-nav (>=1024px) / fixed bottom tab-bar (<1024px)
  Logo.tsx                      — the real CrewTracker mark (see Design system above); never render it bare
  ThemeScript.tsx               — inline pre-paint script, applies saved light/dark theme with no flash
  ui/                           — Signal primitives: Button, Card, Chip, Toggle, ThemeToggle, Dropdown, AccountMenu
  NewShowModal.tsx              — create show: rooms field, timezone, payroll preset; auto-generates work_days
  AddRoomModal.tsx               — add room to a work day (optionally all remaining days); blocks duplicate room names on the same day
  RoomActionsMenu.tsx            — rename/delete a room, plus an "Edit crew" panel (per-crew remove, role dropdown, day-rate edit)
  StaffRoomModal.tsx             — bulk staff crew into a room ("apply to all remaining days" defaults checked); role dropdown from av_roles, rate picker
  AddDayButton.tsx / CopyCrewButton.tsx — extend the show a day; copy the previous day's roster into an empty room
  TimecardRow.tsx / TimeEntryModal.tsx — punch rows + manual time entry w/ chronology validation; TimecardRow renders as a ruled grid row on desktop, a labeled card on mobile
  BatchPunchBar.tsx / BatchTimeModal.tsx — room-level batch punch actions and batch time entry
  MobileRoomTracker.tsx          — the <1024px tracker layout
  CrewDirectoryClient.tsx / EditCrewMemberClient.tsx — Directory goes to a real data table on desktop
  TeamListClient.tsx / EditMemberClient.tsx / PermissionsEditor.tsx / InviteTeammateModal.tsx — org member admin
  EditShowClient.tsx             — all Edit Show fields batched into one Save button; Crew & Rates $ display respects Shoulder Surfer Mode; two-column on desktop
  RulesetFields.tsx              — the shared payroll-rule form, used by Edit Show and the presets editor
  PayrollPresetsEditor.tsx       — named org-level payroll presets (Settings)
  ExportCSVButton.tsx / ExportPDFButton.tsx — gated by financials permission
  SendHoursButton.tsx            — per-crew timesheet via Text / Share / Copy, hours only, never dollars
  SendFinalReportButton.tsx / UnlockShowButton.tsx — end-of-show sign-off and the admin unlock
  ArchiveShowButton.tsx / PersonalSettingsClient.tsx / OrgSettingsClient.tsx / AVRolesEditor.tsx — Settings goes two-column on desktop
lib/
  schedule.ts   — the cross-show booking query; the only place that reads across shows
  crewCall.ts   — position counting (summarizeCall/describeCallSize) + day scopes
  crewCallGrid.ts — the rooms×days call model, pure and unit-tested
  bookingEmail.ts / callHandoffEmail.ts / bookingInvite.ts — crew requests and the handoff
  supabase/client.ts / server.ts / admin.ts
  payroll.ts    — TypeScript port of iOS PayrollCalculator
  punches.ts    — punch ordering/labels + chronology validation; formatPunchTime takes a use24Hour flag
  datetime.ts   — wall-clock <-> instant conversion in a named timezone (see Past incidents)
  reportCsv.ts / reportPdf.tsx — the CSV and PDF documents, as plain modules so the browser download
                  buttons and the server-side Final Report render the identical file. reportPdf takes
                  @react-pdf's parts as an argument so it works in both environments.
  timesheet.ts  — per-crew plain-text timesheet for SendHoursButton (deliberately dollar-free)
  ruleset.ts    — payroll ruleset field list + the Continuous Time / Working Lunch mutual exclusion
  permissions.ts — role presets and permission metadata, shared by the team screens
  timezones.ts  — the one shared timezone list (New Show and Edit Show used to disagree)
  crew.ts       — crew-member helpers
  phone.ts      — phone formatting/normalisation
  invite.ts     — acceptInvite(): finalizes invite, seeds default av_roles for new orgs
  trackerLayout.ts — shared grid template for the tracker console punch table (kept out of a 'use client' file on purpose, see Past incidents)
  cn.ts         — tiny classnames-joiner helper used across the ui/ primitives
proxy.ts        — auth middleware (protects all routes except /login, /auth/*, /invite/*, /join-beta, the keepalive cron, and exactly "/")
scripts/
  run-sql.mjs   — runs a .sql file; dev by default, --prod for production (npm run db:sql)
  db-dump.mjs   — pg_dump wrapper, always production (npm run db:dump / db:schema)
  db-grants.mjs — regenerates sql/grants.sql from production (npm run db:grants)
  db-migrate.mjs— applies sql/migrations/ in order, once each (npm run db:migrate)
  db-seed.mjs   — fills a DEV database with generated fake data (npm run db:seed)
  dev-set-password.mjs — sets a DEV account's password when the generated one is lost
                  (npm run dev:password -- <email> '<password>'). Service role, so it needs
                  no old password — which is why it refuses the production ref, no override.
  sql/
    schema.sql       — generated baseline; the shape of the database. Do not hand-edit.
    out-of-schema.sql— generated; triggers pg_dump --schema=public can't see
    grants.sql       — generated; revoke-then-grant, carries the day_rate lockdown
    migrations/      — numbered changes applied by db:migrate. Append only; never edit one that ran.
                       0011 schedule indexes · 0012 crew_call_positions + booking_status
                       0013 scheduler_id/call_approved_at · 0014 booking_invites
                       ALL APPLIED TO DEV ONLY — production has none of them yet.
    applied/         — the 24 pre-migration-system scripts. Historical reference; never re-run.
    checks/          — read-only diagnostics (integrity sweep, policy checks). Safe to run anytime.
```

## Database schema

- `organizations` — id, name, created_at, timecard_rounding_minutes (default 1 = exact minute; 15/30 also valid), final_report_emails (comma-separated recipient list for the Final Report), default_cc_email. Has an UPDATE policy gated to `can_manage_users`. **`default_cc_email` is orphaned** — it predates the Final Report, which shipped using `final_report_emails` instead. It is still written by the Settings page but read by nothing. Wire it up or delete it; don't assume it does anything.
- `profiles` — id (= auth.uid), organization_id, full_name, email, base_role, use_24_hour_time (bool), shoulder_surfer_mode (bool), + permission booleans
- `subscriptions` — one per org, auto-created via `handle_new_organization()` trigger
- `invitations` — token-based invites; `token`/`expires_at` have DB defaults
- `shows` — id, organization_id, name, venue, start_date, end_date, timezone_identifier (default America/Chicago), archived (bool), client_company, job_number, show_notes, show_financials (bool, gates $ visibility), city_state, created_by, plus the Final Report sign-off trio: `finalized_at` (non-null = times locked), `finalized_by`, `final_report_recipients` (audit snapshot of who it went to)
- `show_assignments` — links users to specific shows; carries a denormalized `organization_id` (see Past incidents)
- `payroll_rulesets` — one per show; mirrors iOS `PayrollRuleset`, plus `continuous_time_enabled`
- `payroll_presets` — org-level named rule sets (one flagged `is_default`), **copied** into a show's `payroll_rulesets` at creation. Never a live link — a live link would retroactively rewrite closed shows. Writes gated on `can_manage_rulesets`.
- `work_days` — id, show_id, date, day_number
- `rooms` — id, work_day_id, name (scoped to a day, not persistent across the show). Has full SELECT/INSERT/UPDATE/DELETE policies (UPDATE/DELETE added when room rename/delete UI was built).
- `timecards` — id, room_id, crew_member_id, crew_member_name, role, day_rate, is_travel_day, travel_in_day, travel_out_day, pay_as_half_day. Partial unique index on `(room_id, crew_member_id) where crew_member_id is not null`. Four triggers: the finalized-show write block, and the two that keep `day_rate` show-wide (see Payroll business logic).
- `punches` — id, timecard_id, punch_type (`start|meal_out|meal_in|meal2_out|meal2_in|end`), punched_at
- `crew_members` — id, organization_id, full_name, email, phone, notes
- `rate_cards` — id, crew_member_id, role, day_rate
- `av_roles` — id, organization_id, name, sort_order, created_at — per-org job title list, auto-seeded with 31 defaults on org creation (guarded against duplicate seeding — this broke once, see below). Existing orgs are never backfilled when the seed list changes.

Helper functions: `my_organization_id()`, `can_see_all_shows()`, `show_id_for_room()`.
Triggers: `on_auth_user_created → handle_new_user()` (had a `search_path` bug that broke all signups — needs `SET search_path = public`), `on_organization_created → handle_new_organization()`, plus the `timecards`/`punches` triggers noted above.

## Permissions system

Two-layer model on `profiles`: `base_role` (admin/staff/pm/crew preset) + individual boolean toggles, customizable per user by an admin. **No cross-organization visibility, ever — including scheduling.** One login can hold memberships in several companies, but nothing about company A's work may surface in company B. Specifically: if a person is booked on a show at A, a scheduler at B must **not** see them flagged as unavailable, busy, or double-booked. Dan stated this as a hard rule (2026-07-28), and it holds today by construction rather than by intent — `crew_members` rows are per-organization with no shared identity between them, and every schedule query is scoped by the caller's RLS, so another org's bookings are never in the result set to begin with. Two things would break it, so don't do either: matching people across organizations by email/phone/name to build a "same person" link, or reading bookings with the service role in any scheduling path. This gets more dangerous, not less, when crew logins arrive — one human with one login across two companies is exactly where the leak would appear.

Financial visibility in reports/exports requires **both** `show.show_financials` (does this show track $ at all) **and** `profile.can_view_pay_rates` (is this user allowed to see pay rates).

Permission columns: `can_manage_users`, `can_manage_billing` (hidden), `can_manage_crew_directory`, `can_import_crew`, `can_view_crew_contacts` (hidden), `can_create_shows`, `can_edit_all_shows`, `can_archive_shows`, `can_duplicate_shows` (hidden), `can_edit_timecards`, `can_approve_timecards` (hidden), `can_view_pay_rates`, `can_edit_pay_rates`, `can_manage_rulesets`, `can_view_reports`, `can_export_reports`, `can_send_reports`, `view_only`.

## Payroll business logic (`lib/payroll.ts`)

- Day rate base: hourly = `dayRate / overtimeAfterHours`. Crew always get at least their full day rate (minimum guarantee).
- **A day rate is a property of the SHOW, not of a day.** It is keyed on (show, crew member, role) and must never differ between days — a per-day rate is a data-entry mistake. Role is in the key because one person legitimately holds different rates in different roles on the same show, and reports group on `name|role`. Enforced by two triggers on `timecards` (`scripts/sql/applied/show-wide-day-rate.sql`): a BEFORE INSERT that makes a new timecard inherit the show's existing rate — **overriding whatever the caller supplied**, which is why StaffRoomModal locks its rate field — and an AFTER UPDATE that propagates a change to every day of the show. A blank role counts as a role to both, and `0` is a real rate (unpaid crew), so never test `day_rate` for truthiness. Nothing writing to `timecards` needs special handling; the triggers cover it.
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

- **No-show / cancelled day flag** — a per-crew-member, per-day flag (alongside the existing `is_travel_day` / `pay_as_half_day` toggles on `timecards`) marking a day as a no-show or cancellation, distinct from a day with punches. The one remaining gap with real payroll consequences. **There is no iOS reference — verified 2026-07-26 that the Swift `Timecard` has only the same four flags we do**, so this is new design, not a port. Open questions for Dan, all contractual rather than technical: does a cancelled day pay anything (notice-window cancellation fees are common)? Is "crew no-showed" the same state as "we cancelled" — different fault, probably different pay? Should a flagged day count as the "previous day" for short-turnaround rest math (probably not — nobody worked)? Does it appear in reports as a $0 line or vanish?
- ~~Inviting people is manual and loses invitations.~~ **DONE 2026-07-27/28.** Invitations are emailed on creation from `noreply@contact.crewtracker.app` (`lib/inviteEmail.ts` + `app/api/invites/send/route.ts`), carrying the inviter's name and the company in subject and body. `PendingInvitesList.tsx` on the Team screen lets an org admin see every pending invite, copy the link again, change the role, resend the email, or cancel it — cancelling kills the link immediately. Authorization is the existing RLS policy: the invite is read through the caller's session, so another org's invitation returns 404.

- ~~Per-control UI disabling on a locked show.~~ **DONE 2026-07-27.** A `locked` flag threads into every control that writes `timecards` or `punches` — punch cells, travel/half-day toggles, reset, batch punching, staffing, copy crew, Edit crew — in both the desktop and mobile trackers, each with a title explaining why. Room rename/delete and Add Day are deliberately left enabled: the lock covers those two tables only, so disabling them would misrepresent it.

- **Per-organization branding of outward-facing email and pages (white-label).** Raised by Dan 2026-07-28 after seeing the handoff and crew-request emails: a production company sending a booking request to its own crew will want it to look like *their* company, not CrewTracker. Affects every outward surface — `lib/inviteEmail.ts`, `lib/callHandoffEmail.ts`, `lib/bookingEmail.ts`, the Final Report PDF, and the public `/book/[token]` page. Deferred, not designed. Two things make it more than a logo swap: the sender domain (Resend needs a verified domain per sender, so `noreply@contact.crewtracker.app` cannot simply become the customer's address without them proving ownership), and the fact that a crew member working for three companies should see three different-looking asks. Build the surfaces so the org name and mark are already data rather than constants, and this stays a change of values rather than a rewrite.

- **The admin screens still use cards** (Team, Edit Crew, Edit Show) — the last of the card retirement (see Design system). Reports was converted 2026-07-28.
- **Tracker leftovers** — the per-crew card wrapper on mobile. The **room** wrapper is no longer a leftover: as of 2026-07-29 desktop boxes each room too (`rounded-card border border-line bg-surface` on the room block in `shows/[id]/page.tsx`), which is what mobile had been doing all along — desktop was the half that disagreed. Deliberately no `overflow-hidden` on that box, because `RoomActionsMenu` opens a dropdown out of it. Also still open: booking status is not shown *beside the role* on a crew row. The column is now fetched (`booking_status` is in `TIMECARD_SELECT` as of 2026-08-02), so this is just display work — reuse the chip renderer in `CrewCallModal.tsx` rather than writing a second label/tone mapping.

- **Declined bookings are filtered on read, in one place.** A declined person keeps their `timecards` row on purpose (migration 0012: it records that we asked and they said no) and does not hold their position. Nothing taught the *read* side that, so until 2026-08-02 a decliner rendered as ordinary staffed crew on the tracker, in reports, and in the emailed Final Report — while the same position also showed as Open. `lib/timecardFields.ts` now owns the rule via `fetchLiveTimecards()` and `liveBookings()`, applied in SQL (`.neq`) so a caller who forgets to select the column can't silently compare `undefined`. **Some queries must still see declined rows** and say so in a comment: `lib/crew.ts` (a write that nulls the FK before delete), the duplicate-staffing guards in `StaffRoomModal`/`CopyCrewButton` (`timecards_room_crew_uniq` has no `booking_status` predicate, so a declined row still occupies the slot), the booking API routes that set the status, and `lib/bookingInvite.ts` (the page a person declines *on*). `lib/payroll.ts` must never read `booking_status` — filter the input set, never the calculator.
- **Historical shows have no positions**, so the shows list reports them as booked-without-positions. Whether to backfill positions from existing timecards is an open data decision, not a display one.
- **Stripe billing** — planned. `can_manage_billing` and the `subscriptions` table exist as placeholders; no integration started.
- ~~Supabase auth emails are unbranded.~~ **DONE 2026-07-28.** Custom SMTP points Supabase Auth at Resend (`noreply@contact.crewtracker.app`), which also lifts the built-in sender's rate limit, and all four templates are branded — source of truth in `docs/email-templates/`, applied by hand in the dashboard. Verified live: password reset and magic-link sign-in both arrive branded and work. Supabase's "Invite user" template is deliberately untouched; CrewTracker sends its own.

- Microsoft/Azure SSO, Capacitor iOS/Android wrapping — still deferred
- Crew app access (crew role) — schema ready, UI deferred
- **A web texting service (Twilio et al.) is deliberately not being used.** Crew timesheet delivery is device-native — `SendHoursButton` offers `sms:` / Web Share / clipboard depending on what the browser supports. That feature is **built**; this note is about not replacing it with a paid SMS gateway.
- ~~Superadmin pages still on the old zinc palette.~~ **DONE 2026-07-27** — all of `app/superadmin/*` and `SuperAdminClient.tsx` are token-driven; no hardcoded colours or raw radii remain.
- No public self-serve signup — new orgs are onboarded only via superadmin-generated invite links. The "Join the Beta" form is a lead-capture funnel, not an auto-provisioning flow, so this stays true. **One thing did quietly contradict it:** `signInWithOtp` defaults `shouldCreateUser` to TRUE, so the login page's "Send magic link instead" created an account for any address typed in and sent the *Confirm signup* email. Found 2026-07-28 when a magic-link request recreated an account deleted the day before. The login page now passes `shouldCreateUser: false`; the invite page keeps the default, because creating an account is the point there and it is gated by a valid token. Any future `signInWithOtp` call needs the same decision made explicitly.

### Already built — do not rebuild these

- **Scheduling (2026-07-28).** The whole workflow, on branch `scheduling` and **not yet merged to main — none of it is in production**:
  - `/dashboard/schedule` — company-wide calendar, rooms×days grid on desktop, agenda on mobile. `lib/schedule.ts` holds the cross-show query.
  - **Positions** — `crew_call_positions`, one row per person per day, hung off a room. Built in the rooms×days grid on `/dashboard/shows/new` or from a room's ⋮ → Positions. `lib/crewCallGrid.ts` is the pure model; `lib/crewCall.ts` has `summarizeCall`/`describeCallSize` and the day-scope helpers.
  - **Handoff to a scheduler** — `shows.scheduler_id` / `call_approved_at`, approved from the show page, emails the scheduler. Requires at least one position.
  - **Booking requests** — `booking_invites`, emailed confirm/decline link at `/book/[token]` with no login, plus an SMS-ready text with deliberately no link. `booking_status` on `timecards` is `pencilled → invited → confirmed | declined`. A decline frees the position (partial unique index) while keeping the row.
  - **Filling positions** — `FillPositionPicker`, role-filtered, warns on same-day conflicts *within this organization only*. Reachable from the positions panel **and** from open-position rows in the tracker.

This list drifted badly once and sent a session off to re-implement finished work. If something here looks missing, search the repo before believing it.

- **Admin UI for user privileges** — `app/dashboard/team/` + `PermissionsEditor.tsx`, gated on `can_manage_users`.
- **`day_rate` column-level lockdown** — done, and this entry replaces a stale "not yet built" one that survived here after the work shipped. `authenticated` holds **no `SELECT` grant** on `timecards.day_rate` or `rate_cards.day_rate`; reads route through the `timecard_day_rates` / `crew_rate_cards_visible` SECURITY DEFINER views, which check the caller's permission per query. Re-verified on production 2026-07-27: a direct read returns `42501` for every account including admins, and the write side is guarded separately by `enforce_pay_rate_write_permission` (raises on UPDATE, silently drops the rate on INSERT so staffing still works). This is what makes "the PM never sees the numbers" a real boundary rather than a convention.
- **Multi-organization data model** — one login can hold memberships in several organizations, with separate permissions in each, and switch between them from the account menu. `memberships` is the source of truth; `profiles.organization_id` and the 18 `can_*` columns still exist as a derived mirror and are due to be dropped. See migrations 0001–0006.
- **Email report delivery via Resend** — the Final Report (`api/reports/final/route.ts`), which also locks the show.
- **"Join the Beta" interest form** — `/join-beta` + `api/beta-signup/route.ts`.
- **Per-crew timesheet Text/Share/Copy** — `SendHoursButton.tsx`.
- **Named payroll presets, Continuous Time, Pay As Half Day UI, room rename/delete, per-crew removal, show archiving, batch travel-day toggle, reset punches, Copy Crew, Add Day from the tracker** — all shipped.
- The whole Settings page: 24-hour time, Shoulder Surfer Mode, org-wide timecard rounding, AV Roles editor, payroll presets, Final Report recipients.

## Past incidents worth remembering

- **The repo lives inside Dropbox, including `.git`.** Mid-session, working-tree files *and* `.git` were replaced by Dropbox sync: `git show HEAD:components/RoomActionsMenu.tsx` returned 131 lines early on and 260 lines later, with `HEAD` reported as the same commit both times. Any file read before that sync completed was stale. Practical consequences: a two-machine edit can corrupt the index or produce torn commits, `git status` can disagree with disk, and analysis done against a partly-synced tree is unreliable. **Re-read files rather than trusting an earlier read in the same session** — and this is a large part of why targeted edits beat whole-file rewrites here, since a targeted edit fails loudly on a stale read while a rewrite silently overwrites from memory. Running only one Claude session at a time avoids the worst of it.
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
- **Custom domain:** `crewtracker.app` (registered + DNS-hosted at Netlify via NS1) points at the Vercel app. Only the website records changed — apex `A @ → 76.76.21.21` and `www A → 76.76.21.21`; `www.crewtracker.app` is set to a 308 redirect to the apex in Vercel's domain settings. **DNS deliberately stays at Netlify** so the verified Resend email records (`contact.crewtracker.app`: MX/SPF/DKIM, plus `_dmarc`) are preserved — don't move nameservers to Vercel or those break. Supabase Auth Site URL is `https://crewtracker.app` with `https://crewtracker.app/**` and `https://www.crewtracker.app/**` in the redirect allowlist. All app auth redirects derive from `window.location.origin`, so no code is domain-pinned. To roll back: repoint the apex/www A records to Netlify's IPs (`98.84.224.111`, `18.208.88.157`) and re-add the domain to the Netlify site.
- `crewtracker-lime.vercel.app` remains the stable Vercel origin (still valid); deployment-specific preview URLs are not.
