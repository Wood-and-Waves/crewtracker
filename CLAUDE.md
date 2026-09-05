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
- `qrcode` for the crew-clock venue QR (SVG, generated in the browser from `window.location.origin`)
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
- **When asking to commit or push, state the blast radius in the same sentence.** Dan approves far faster when he doesn't have to infer what a change can reach. Say the branch AND whether it touches customers — *"Commit to `scheduling` — preview only, crewtracker.app untouched"* vs *"Push to `main` — this deploys to the live site."* Two things make that sentence non-obvious, so spell them out rather than assuming: a commit is **local** until pushed and is not "to" any server, and a branch is not a database. Production deploys only from `main`; every other branch builds a preview against the **dev** database. If a change also touches a database, name which one (dev, or `--prod`) in the same breath — that is a separate axis from the branch, and it is the one that can destroy real data.
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
- **Vercel CLI**: installed globally (2026-08-03) and signed in as `dan-2811`; the repo is linked to `crew-tracker/crewtracker`. `vercel inspect crewtracker-lime.vercel.app` / `vercel ls crewtracker` check deployment status after a push instead of guessing whether a deploy succeeded. `vercel link` appends a managed `VERCEL_OIDC_TOKEN` to `.env.local` — that is normal, and it leaves the existing keys alone.
  - **`vercel env pull` cannot read the values back.** Every variable on this project is flagged sensitive, so the pulled file contains the literal string `[SENSITIVE]` in place of all five. Don't diff those placeholders against real keys and conclude anything — that produces a confident, wrong answer. Read values from the dashboard, or test behaviour directly.
- **Preview deployments point at the DEV database** — confirmed 2026-08-03 by opening a preview and seeing the seeded fake crew (Alex Reyes et al). Preview and Production hold entirely separate `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / anon key entries, so **production's service-role key is never in a preview build**, and a branch preview is safe to browse. It also means a preview exercises whatever migrations dev has — write and verify a migration on dev, and the preview proves it, before `--prod` ever runs. Branch preview URL: `https://crewtracker-git-<branch>-crew-tracker.vercel.app`, behind Vercel's own login.

## Design system — "Showbill" (replacing "Signal", build started 2026-08-04)

**The app wears Showbill everywhere** (transition from Signal completed 2026-08-06, in
production since the same day's cutover) — a full identity redesign Dan chose
through a mockup-reaction process (2026-08-03/04). Decisions, all locked with Dan and recorded in
auto-memory (`showbill-identity-decisions.md`):

- **Paper-first, ONE identity.** Light is the flagship: warm paper `#F9F4E5`, warm ink
  `#221E16` (both warmed 2026-08-07, twice — the first cut was a cool off-white that made the ink
  masthead read as black-on-grey; warming the ground took the edge off without softening
  the ink). Header chrome is `--surface-2` `#F2EBD8`, a shade off the paper. Verified AA at this
  warmth: ink 15:1, muted 5:1, accent 6.7:1 — push the cream much further and `--muted`
  on `--surface-2` (4.65:1 today) is the first thing to drop below AA.
  Dark is a faithful derivative (same document printed on black, ground `#121317`) reached via
  the existing app-wide toggle — **never a separate personality per screen**; Dan explicitly
  rejected the tracker defaulting dark while other pages are light.
- **Brand: "Crew Blue"** — `--accent` is `#2A52A8` light / `#4D8BFF` dark, evolved from the
  logo's original blues. The accent is reserved for ACTIONS; day-type tints carry data.
- **Day-type tint tokens** (`--day-travel/loadin/rehearsal/show`, exposed as `bg-day-*`):
  show-family days green, load-in amber, rehearsal violet, travel-family slate. Color is
  information, never decoration.
- **Squared geometry.** "Bubble-like, iOS forced to big screen" was the named disease. Radii
  tokens are now 2–3px; buttons are uppercase/bold, ghost buttons wear a 2px ink border;
  Showbill screens use ink mastheads and color-blocked table headers (see the Showbill synthesis
  artifact d8ba5dd8 for the reference mock).
- **Type:** Oswald (via next/font, exposed as the `font-display` utility) for mastheads,
  headings and small-caps labels; system stack for body; mono tabular for aligned digits.
- **Logo: Dan is redesigning it himself.** The old mark stays in place until his artwork lands;
  recolor mapping when it does: `#6699FF→#4D8BFF`, `#3366CC→#2A52A8` (his "Option A"), then
  regenerate `app/icon.png`, `favicon.ico`, `public/app-icon.png`.
- **Open Paper (2026-08-06, approved from a mockup before any code touched it).** Reviewing
  the B1 preview, Dan: *"I got hung up in the boldness of marquee and completely missed that
  it lives inside cards … No boxes is sooooooo much better."* Content sits directly on the
  paper ground; containers and panels are gone. Boundaries come from four devices, defined in
  `lib/panel.ts` and `components/ui/NumberedHead.tsx`:
  - **BAND** — a solid masthead strip (`bg-band text-band-ink border-b-2 border-ink`): a
    screen's title block, a room on the tracker. Ink slab on light, lifted strip on dark
    (`--band`/`--band-ink` tokens). **ONE solid band per screen.** The list screens
    (shows, directory, team) briefly had two — page title *and* table header — and Dan
    called it out 2026-08-07 ("why are they black now?"): stacked a hundred pixels apart
    they made the screen top-heavy. A data table's column header is now a LIGHT strip
    (`bg-surface-2` closed by `border-b-2 border-ink`). The tracker and Reports are the
    exception that proves the rule: their bands are per-room and per-day, one at a time
    down the page, so they never stack.
  - **RULE_MAJOR** — 3px ink rule closing a section or a table. `NumberedHead` renders it
    with a blue Oswald numeral where a screen's sections are a genuine sequence (New Show 1–4).
  - **Hairlines** (`border-line`) for rows *within* a unit. Weight must mean something —
    uniform hairlines everywhere was July's monotony bug.
  - **Whitespace** — units are separated by space plus the next band, never by an edge.
  What legitimately keeps a box: form fields (a printed form's fill-in boxes) and true
  overlays — dropdowns, dialogs, and in-place editors. Nothing else. `PANEL` is deleted
  from lib/panel.ts — nothing imports it anymore.
- **Build status (2026-08-06): every main screen has had its Open Paper pass** — tokens/
  primitives (B1), New Show (B2), tracker (B3, incl. the lit-next-key punch treatment and
  room masthead bands on both layouts), then shows list, reports, settings (incl.
  RulesetFields), directory, team, schedule. All native `<select>`s on those screens are
  `components/ui/Select` (the Showbill picker: squared field closed, ink-bordered paper-slip
  panel open, optional swatches, keyboard + typeahead). Day-type tints were re-cut to
  accent-weight chroma at Dan's request. **The card era is over in the main app**
  (2026-08-06, later that day): Edit Show, Edit Crew and the team member editor are ruled
  sections; every dialog and menu wears the paper-slip overlay (`border-2 border-ink
  shadow-edge`); the top nav is bg-bg (the chrome IS the paper — a white strip over the
  ground was Dan's "super white" complaint) and the bottom tab bar is a squared, ink-edged
  slab, not the old 26px pill. Still old-skin: the superadmin pages and the auth/invite
  splash screens (deliberate centered sheets; convert only if Dan asks).

## The previous system — "Signal" (2026-07-14/15), kept for layout rules that still apply

**2026-07-28 — cards are being retired.** Dan: *"I think I am about done with the 'cards' design. It is just too clunky with the cards of all different sizes."*

Read that literally: what is being killed is **several boxes side by side that are never the same height** — a grid of cards, each with its own edge, raggedly bottomed against its neighbour. It is the *plural* that was clunky, not the border. The replacement inside a screen is **ruled sections**: small-caps headings, hairline rules, content at full width, rows label-left / control-right with a `border-b border-line` between them.

**Container doctrine — SUPERSEDED 2026-08-06 by Open Paper (see the Showbill section above).** This paragraph is on its third revision, each at Dan's explicit direction, and the history is kept so it doesn't read as churn: **July** killed the *grid of ragged cards*; **2026-07-29** blessed one container per screen plus per-unit panels (each tracker room boxed, each Reports day/person boxed — because a room boundary is a live error surface); **2026-08-06** removed enclosure entirely — the paper is the page, and the room boundary is now a masthead BAND, a *stronger* edge than any 1px frame was. Do not "bring a screen into line" with containers or panels: a screen still wearing them is awaiting its Open Paper pass, not the standard. Two practical notes that survive the transition: the horizontal inset goes on the rows/bands **inside** a unit, never on a wrapper, so rules run edge to edge; and the tracker room block must never get `overflow-hidden`, because `RoomActionsMenu` opens a dropdown out of it and clipping would cut the menu off. Summaries and view controls (the tracker's stat strip, Reports' Master Summary, tabs) still sit above the content they govern.

Converted in the Signal era (historical record): the **shows list** (a real table), **New Show** (a full page), the **tracker** (header strip instead of a left rail, one line per crew member), **Settings** (a left nav, one section at a time), and **Reports** (Master Summary as an inline stat strip, By Day and By Crew as one shared ruled table). Still on cards: the admin screens (Team, Edit Crew, Edit Show). `components/ui/Card` still exists but under Open Paper it is legacy — don't reach for it in new work; boxes belong to form fields and true overlays only.

**No fixed-position dialogs for editing.** An editor that covers the thing you are editing is the pattern being removed. Cell editors, pickers and the payroll-preset editor all open **in place, below** what they belong to. `fixed inset-0` overlays remain fine for genuine confirmations.

**Terminology: it is a POSITION, never a "call".** In this industry a call is a TIME ("call is 8am"), so using it for a list of required roles collides every time. The database table is still `crew_call_positions` and the components are still `CrewCall*` — renaming those is a migration for no user-visible gain — but **every user-facing string says positions**.

The app was fully redesigned from the original pure-black/zinc/iOS-blue look to a direction called **Signal**: near-true-black (light theme also fully supported, both first-class), bold white headers, the brand's electric blue as the sole accent, no glow effects (tried in an early mockup round, Dan rejected it — use a crisp `ring-1 ring-inset ring-accent` instead), minimal monospace (tried "everywhere," Dan found it too techy — reserve mono for places digits must align in columns).

**Everything is token-driven — never hardcode a color.** Tokens live in `app/globals.css` as CSS variables (`--bg`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--line`, `--accent`, `--accent-ink`, `--accent-wash`, `--ot`, `--good`, `--danger`, `--radius*`), mapped into Tailwind v4's `@theme inline` so they're usable as ordinary utilities: `bg-surface`, `text-ink`, `text-muted`, `border-line`, `text-accent`, `rounded-card`, `rounded-field`, `rounded-pill`. Light values are the `:root` default (media-query fallback via `prefers-color-scheme: dark` for the dark values); an explicit `data-theme="light"|"dark"` on `<html>` (set by `components/ui/ThemeToggle.tsx`, persisted to `localStorage['ct-theme']`, applied pre-paint by `components/ThemeScript.tsx` to avoid a flash) overrides the media query in both directions. **If you introduce a new color, add it as a token in globals.css, not as a one-off Tailwind class** — that's the whole point of the system Dan asked for, so future restyles are a one-file edit.

**Reusable primitives** in `components/ui/`: `Button` (variants: primary/ghost/danger), `Chip` (tones: neutral/live/ot/good/danger — semantic status color, kept separate from the brand accent), `Toggle` (squared on/off switch, replaces native checkboxes everywhere), `Select` (the Showbill picker — replaces native `<select>` everywhere; zero native selects remain in the app), `NumberedHead` (numbered section head on a 3px rule), `ThemeToggle`, `AccountMenu`, and legacy `Card` (splash/onboarding/superadmin only — never new work). The old `Dropdown` primitive is deleted; `Select` is its replacement. Compose new UI from these rather than writing raw styled `<button>`/`<div>` markup.

**One deliberate exception to the token rule:** `lib/reportPdf.tsx` uses literal hex colors. `@react-pdf/renderer` renders outside the browser, so CSS variables don't exist there, and a PDF is a fixed document with no light/dark mode to respond to. Don't "fix" it into tokens.

**Responsive nav, not just responsive layout:**
- **≥1024px** (landscape iPad + desktop): `AppShell.tsx` renders a sticky **top nav bar** (logo, Shows/Directory/Settings links, theme toggle) — a mouse-driven desktop experience, not a shrunk sidebar.
- **<1024px** (portrait iPad + phone): top nav hides, a **fixed bottom tab-bar** (`position: fixed`, stays pinned while content scrolls) takes over — an app-like phone experience.
- **Not every screen is phone-first. New Show is a laptop screen** — Dan, 2026-08-03: *"I don't think that the show creation page will be used as much on the phone. Maybe an iPad. But mainly laptops."* This is the screen where somebody sits down and builds a run, so verify it at 1440×900 with a LONG run (20 days) before calling it done. Optimising it for 375px produced a real regression: day types one row per day made the page 1943px tall and pushed the positions grid nearly two screens down. The tracker is the opposite — that one is used on-site, on a phone, in the dark.
- **Desktop screens restructure, they don't just stretch mobile layouts.** Directory becomes a real data table with search on desktop, collapsing to tappable rows below 1024px. Settings goes two-column (Personal + Org side by side, AV Roles full-width) on desktop. Same principle applies to any future screen that feels sparse when simply widened.
- Any screen with a floating fixed-position action button (e.g. Edit Show's "Save Changes" pill) must clear the bottom tab-bar's position below 1024px — use an offset like `bottom-24 lg:bottom-6`, don't let two fixed-bottom elements collide.

**The tracker console's punch table** (`TimecardRow.tsx` + the room block in `shows/[id]/page.tsx`) is a genuine ruled grid on desktop (`lg:grid-cols-[...]`, shared between the header row and every crew row via `lib/trackerLayout.ts`), collapsing to labeled per-field cards on mobile. This replaced free-floating pill buttons after Dan's first-round feedback that times weren't visually separated.

**Safari gotcha, current: `input[type="time"]` has an intrinsic min-width that BEATS `w-full`.**
Driven by font size, so the bigger the field the worse it gets — the crew clock's `text-3xl`
picker rendered wider than its own dialog and hung off the right edge on a real iPhone while
fitting fine in Chromium. `min-w-0` is the fix (plus `max-w-full` as a belt); every
`input[type="time"]` in the app now carries it. Verified by measuring the field's right edge
against its dialog's, not by eye.

**Known Safari gotcha (now historical — zero native `<select>` elements remain; `components/ui/Select` replaced them all 2026-08-06, which sidesteps both bugs by construction).** Kept in case a native select is ever reintroduced: `<option>` needs explicit `className="bg-surface-2 text-ink"` or its text is invisible against a dark background in Safari, and iPad Safari has a hydration bug that duplicates `<option>` elements in a controlled `<select>` — fix is a `key` prop on the `<select>` tied to a stable identifier of the options list so React remounts instead of patching in place. Prefer just using `Select`.

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
    page.tsx                   — the shows list (masthead band + open table); onboarding fallback if no org
    directory/page.tsx         — Crew Directory list
    directory/[crewId]/page.tsx — Edit Crew Member
    team/page.tsx              — org member list (admin)
    team/[userId]/page.tsx     — per-user role + permission editor, gated on can_manage_users
    shows/[id]/page.tsx        — Show workspace: day nav, room columns, tracker console
    shows/[id]/edit/page.tsx   — Edit Show: info, timezone, financials toggle, full payroll ruleset, Crew Clock links
    shows/[id]/clock/print/page.tsx — printable venue QR sign (AppShell chrome is print:hidden)
    shows/[id]/reports/page.tsx — By Day / By Crew, Master Summary, CSV/PDF export, Send Hours, Final Report
    shows/new/page.tsx          — create a show: details, payroll preset, and the rooms×days positions grid
    schedule/page.tsx           — company-wide calendar across shows
    settings/page.tsx           — personal prefs, org settings, AV Roles editor, payroll presets
  api/
    admin/create-invite/route.ts — server-side invite creation (service role, bypasses RLS)
    invite/accept/route.ts       — finalizes invite acceptance for password sign-in path
    clock/identify/route.ts      — trades a venue QR for one person's personal link (POST only)
    clock/punch/route.ts         — the public punch write; owns every rule the DB doesn't (POST only)
    beta-signup/route.ts         — Join the Beta form submissions -> Resend
    reports/final/route.ts       — Final Report: renders CSV+PDF server-side, emails admin-designated recipients, locks the show
    keepalive/route.ts           — daily cron ping so Supabase's free tier doesn't pause (see Notes)
  clock/[token]/page.tsx       — PUBLIC crew clock: personal link punches, venue QR picks room then name
  invite/[token]/page.tsx      — invite landing page
  invite/[token]/InviteAuthForm.tsx — client auth form for invite flow
  login/page.tsx               — Google SSO + email/password + magic link + forgot-password link
  superadmin/page.tsx          — super admin panel
  superadmin/invite-org/page.tsx — generate new org invite links
components/
  AppShell.tsx                 — responsive top-nav (>=1024px) / fixed bottom tab-bar (<1024px)
  Logo.tsx                      — the real CrewTracker mark (see Design system above); never render it bare
  ThemeScript.tsx               — inline pre-paint script, applies saved light/dark theme with no flash
  ui/                           — Showbill primitives: Button, Chip, Toggle, Select, NumberedHead, ThemeToggle, AccountMenu, legacy Card
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
  CrewClockPanel.tsx / CrewClockSign.tsx — mint/copy/revoke crew clock links on Edit Show, and the printable venue QR
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
  clockLinks.ts / clockSession.ts — clock link URL + expiry (pure, tested) and the service-role
                  reader for the public page; clockSession never uses select('*')
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
  test/         — `npm test` runs all four in order; each is plain Node with a tiny check()
                  helper, no framework. 256 assertions as of 2026-09-05.
    payroll.mts   — the calculator, against the Swift original (npm run test:payroll)
    schedule.mts  — date arithmetic, the call grid, canUseScheduling (npm run test:schedule)
    clock.mts     — crew clock URLs/expiry, the Slack list, roundWallTime, and the
                    two-check punch guard (npm run test:clock)
    rls.mts       — real anon/authenticated sessions against DEV; the ONLY test that can
                    catch an RLS bug, since db:sql bypasses RLS (npm run test:rls)
    alias-loader.mjs — resolves `@/` imports so the .mts files can import from lib/
  sql/
    schema.sql       — generated baseline; the shape of the database. Do not hand-edit.
    out-of-schema.sql— generated; triggers pg_dump --schema=public can't see
    grants.sql       — generated; revoke-then-grant, carries the day_rate lockdown
    migrations/      — numbered changes applied by db:migrate. Append only; never edit one that ran.
                       0011 schedule indexes · 0012 crew_call_positions + booking_status
                       0013 scheduler_id/call_approved_at · 0014 booking_invites
                       0015 work_days.day_type + its UPDATE grant AND policy (both halves or the
                       silent-success bug returns) · 0016 eighth day type (show_load_out)
                       · 0017 scheduling module (organizations.scheduling_enabled +
                       memberships.can_manage_scheduling + the guard trigger)
                       · 0018 crew clock (clock_links + punches.source/created_by/source_link)
                       Applied to BOTH databases — production caught up from 0010 to 0016
                       during the 2026-08-06 cutover. 0017 and 0018 are on DEV only until
                       their cutover.
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
- `punches` — id, timecard_id, punch_type (`start|meal_out|meal_in|meal2_out|meal2_in|end`), punched_at,
  plus the attribution trio from 0018: `source` (`staff|crew`, default `staff` so every pre-existing
  row is correct), `created_by` (null for crew-entered — nobody is signed in), `source_link`.
  **Almost nothing is enforced here**: no chronology trigger, no uniqueness on
  `(timecard_id, punch_type)`, no day-range check. Those rules live in `lib/punches.ts` and every
  writer must apply them itself.
- `clock_links` — the no-login crew clock token. `crew_member_id` NULL = the show's venue QR;
  NOT NULL = one person's personal link. Two partial unique indexes keep one of each.
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

- **Security backlog — four findings, none introduced by recent work** (surfaced 2026-09-04
  while tracing the punch guards; recorded here because they were previously only in a scratch
  plan file). None is exploitable by a stranger; all are internal-permission or
  denial-of-service shaped:
  - **The punch write policies check no permission at all.** Unlike `shows` and
    `booking_invites`, `punches` INSERT/UPDATE/DELETE only test
    `shows.organization_id = my_organization_id()`. So a `view_only` member can write punches,
    and a member can write punches on a show they cannot even see (the write policies join
    `shows` directly and skip the assignment-scoped SELECT rule). Worth fixing first — the
    crew clock added a second write path into that table.
  - **`UnlockShowButton` needs only `can_edit_timecards`**, not admin, so the copy "an admin
    can unlock it" overstates the protection on a finalized show. Either gate it or reword it.
  - **No rate limiting anywhere in the app.** `/api/bookings/respond` is replayable and each
    decline re-sends an email, making a leaked link an inbox-flood button; `/api/clock/punch`
    and `/api/clock/identify` are public writes with the same exposure. A per-token throttle
    is the minimum.
  - **The decline email builds its dashboard link from `new URL(request.url).origin`** — i.e.
    the Host header, which is attacker-controlled.
- ~~Inviting people is manual and loses invitations.~~ **DONE 2026-07-27/28.** Invitations are emailed on creation from `noreply@contact.crewtracker.app` (`lib/inviteEmail.ts` + `app/api/invites/send/route.ts`), carrying the inviter's name and the company in subject and body. `PendingInvitesList.tsx` on the Team screen lets an org admin see every pending invite, copy the link again, change the role, resend the email, or cancel it — cancelling kills the link immediately. Authorization is the existing RLS policy: the invite is read through the caller's session, so another org's invitation returns 404.

- ~~Per-control UI disabling on a locked show.~~ **DONE 2026-07-27.** A `locked` flag threads into every control that writes `timecards` or `punches` — punch cells, travel/half-day toggles, reset, batch punching, staffing, copy crew, Edit crew — in both the desktop and mobile trackers, each with a title explaining why. Room rename/delete and Add Day are deliberately left enabled: the lock covers those two tables only, so disabling them would misrepresent it.

- **Per-organization branding of outward-facing email and pages (white-label).** Raised by Dan 2026-07-28 after seeing the handoff and crew-request emails: a production company sending a booking request to its own crew will want it to look like *their* company, not CrewTracker. Affects every outward surface — `lib/inviteEmail.ts`, `lib/callHandoffEmail.ts`, `lib/bookingEmail.ts`, the Final Report PDF, and the public `/book/[token]` page. Deferred, not designed. Two things make it more than a logo swap: the sender domain (Resend needs a verified domain per sender, so `noreply@contact.crewtracker.app` cannot simply become the customer's address without them proving ownership), and the fact that a crew member working for three companies should see three different-looking asks. Build the surfaces so the org name and mark are already data rather than constants, and this stays a change of values rather than a rewrite.

- ~~The admin screens still use cards.~~ **DONE 2026-08-06** — Team, Edit Crew, Edit Show and the team member editor all went Open Paper; see the Showbill build status above. `Card` survives only in the no-org onboarding splashes, the public `/book/[token]` page, `ShowAccessEditor`, and superadmin.
- **Booking status is not shown beside the role on a tracker crew row.** The column is fetched (`booking_status` is in `TIMECARD_SELECT` as of 2026-08-02), so this is pure display work — reuse the chip renderer in `CrewCallModal.tsx` rather than writing a second label/tone mapping.

- **Declined bookings are filtered on read, in one place.** A declined person keeps their `timecards` row on purpose (migration 0012: it records that we asked and they said no) and does not hold their position. Nothing taught the *read* side that, so until 2026-08-02 a decliner rendered as ordinary staffed crew on the tracker, in reports, and in the emailed Final Report — while the same position also showed as Open. `lib/timecardFields.ts` now owns the rule via `fetchLiveTimecards()` and `liveBookings()`, applied in SQL (`.neq`) so a caller who forgets to select the column can't silently compare `undefined`. **Some queries must still see declined rows** and say so in a comment: `lib/crew.ts` (a write that nulls the FK before delete), the duplicate-staffing guards in `StaffRoomModal`/`CopyCrewButton` (`timecards_room_crew_uniq` has no `booking_status` predicate, so a declined row still occupies the slot), the booking API routes that set the status, and `lib/bookingInvite.ts` (the page a person declines *on*). `lib/payroll.ts` must never read `booking_status` — filter the input set, never the calculator.
- **Historical shows have no positions**, so the shows list reports them as booked-without-positions. Whether to backfill positions from existing timecards is an open data decision, not a display one.
- **Stripe billing** — planned. `can_manage_billing` and the `subscriptions` table exist as placeholders; no integration started.
- ~~Supabase auth emails are unbranded.~~ **DONE 2026-07-28.** Custom SMTP points Supabase Auth at Resend (`noreply@contact.crewtracker.app`), which also lifts the built-in sender's rate limit, and all four templates are branded — source of truth in `docs/email-templates/`, applied by hand in the dashboard. Verified live: password reset and magic-link sign-in both arrive branded and work. Supabase's "Invite user" template is deliberately untouched; CrewTracker sends its own.

- Microsoft/Azure SSO, Capacitor iOS/Android wrapping — still deferred
- Crew app access (crew role) — schema ready, UI deferred
- **A web texting service (Twilio et al.) is deliberately not being used.** Crew timesheet delivery is device-native — `SendHoursButton` offers `sms:` / Web Share / clipboard depending on what the browser supports. That feature is **built**; this note is about not replacing it with a paid SMS gateway.
- ~~Superadmin pages still on the old zinc palette.~~ **DONE 2026-07-27** — all of `app/superadmin/*` and `SuperAdminClient.tsx` are token-driven; no hardcoded colours or raw radii remain.
- No public self-serve signup — new orgs are onboarded only via superadmin-generated invite links. The "Join the Beta" form is a lead-capture funnel, not an auto-provisioning flow, so this stays true. **One thing did quietly contradict it:** `signInWithOtp` defaults `shouldCreateUser` to TRUE, so the login page's "Send magic link instead" created an account for any address typed in and sent the *Confirm signup* email. Found 2026-07-28 when a magic-link request recreated an account deleted the day before. The login page now passes `shouldCreateUser: false`; the invite page keeps the default, because creating an account is the point there and it is gated by a valid token. Any future `signInWithOtp` call needs the same decision made explicitly.

## Scheduling is a switchable MODULE (2026-08-09)

The tracker is the product; scheduling is an add-on, eventually a paid one. Dan:
*"maybe not everyone will use scheduling. Or maybe that will be a paid upgrade as it involves
email and such."* The landing page has only ever sold the tracker, so the commercial shape
already matched.

**Two gates, and neither implies the other** — the same shape as `canSeeFinancials`:
- `organizations.scheduling_enabled` — the company's entitlement. **Operator-only**: the
  `organizations` UPDATE policy is COLUMN-BLIND, so without `guard_organization_disabled_at()`
  (which despite its name now guards this column too) any customer admin could switch on their
  own paid feature. Verified 2026-08-09 through a real authenticated session that the guard
  raises — `npm run db:sql` bypasses it and would report a false pass.
- `memberships.can_manage_scheduling` — which people inside that company may use it.

Ask **`canUseScheduling(user)`** (`lib/permissions.ts`, re-exported from `lib/session.ts`).
It lives in permissions.ts because it is pure and session.ts is server-only — importing
session.ts into a test drags in `next/headers` and dies.

**What is in the module**: positions (`crew_call_positions`) and the New Show positions grid ·
room ⋮ → Positions · Fill position · open-position rows on the tracker · handoff to scheduler ·
booking requests (emails, SMS text, `/book/[token]`, record-by-phone) · `/dashboard/schedule` ·
the shows list's **Staffing** column and its sort. **What is NOT**: everything else, including
**day types** (they label what the production is doing and belong to the show) and staffing crew
into rooms (recording who worked is the core product).

**Switching it off deletes NOTHING.** Positions, booking invites and `booking_status` all stay;
the UI is hidden and switching back on restores the feature whole. This is why
`lib/timecardFields.ts` needs no change — with the module off nothing ever reaches `'declined'`,
so the decline filter is simply inert. **Not enforced in RLS**, deliberately, matching the call
recorded for `disabled_at`: a commercial state is not a security boundary, and an RLS gate would
risk cutting a downgraded customer off from exports they are still owed. The API routes
(`api/bookings/*`, `api/shows/approve-call`) re-check server-side and 403; `/book/[token]` stays
public and ungated so an invite already sent can still be answered.

**The trap worth knowing**: `CrewCallGrid` is also the ONLY room editor on New Show. With the
module off it collapses to a rooms-only editor (`schedulingEnabled={false}`) rather than being
hidden — otherwise there would be no way to create a room at all. `roomDayIndices()` already
creates a position-less room on every day, which is exactly the right no-scheduling behaviour.

**Deployment order is load-bearing**: `getCurrentUser()` selects every key in
`ALL_PERMISSION_KEYS` and `my_perm()` raises `undefined_column` on an unknown one, so shipping
the code before migration 0017 makes **every page 400**. Migrate first, then deploy.

Flip it from the superadmin panel (`Scheduling: on/off` beside Suspend →
`api/admin/org-scheduling`). `subscriptions.plan` is deliberately NOT the gate: entitlement and
billing stay separate, so a beta customer can be granted scheduling without inventing a plan.

## Crew clock links — crew punch themselves, no login (2026-09-04)

Dan's purpose: **the PM cannot see everyone** on a multi-room or staggered show, **and the PM
wants crew to carry responsibility for their own punches.** Built toward crew logins, not
instead of them — everything keys on `crew_member_id`, so a real session later resolves to the
same rows through the same write path.

**Crew punches are REAL punches, and finalize is the sign-off.** An earlier design had them
land in a `punch_proposals` table the PM accepted row by row; that was dropped before any code
existed, because four punches × fifty crew is two hundred approvals — more work than batch
punching, and the PM stays the author, so responsibility never transfers. It is also **not**
the `booking_status` / `day_type` case: those are *scheduling states* walled off from payroll.
A punch is not a scheduling state; it is the same time data the PM already enters unverified.
The question was never "is it payroll data" but "is it attributable", and columns answer that.

**`punches.source` is ATTRIBUTION ONLY. `lib/payroll.ts` must never read it** — a crew-entered
hour is worth what a PM-entered hour is worth, and the moment the calculator can tell them
apart somebody will make it pay differently. The tracker marks it (dotted underline + tooltip);
the Final Report's pre-send checks count it. Nothing else.

**Two kinds of link, one table** (`clock_links`): a **personal** link per crew member — the
normal route, handed out in bulk paste-ready for Slack from Crew Clock on Edit Show — and one
**venue** QR per show, printed from `/dashboard/shows/[id]/clock/print`, which carries no
identity and asks for a room then a name before trading itself for that person's link.
Generating links IS the opt-in; there is no separate feature flag. **Core tracker, ungated** —
recording who worked is not the paid module.

**The public route must apply TWO checks, not one.** `getChronologyError` only orders the
punches that EXIST, so it happily accepts an M1 In from somebody who never went to lunch —
there is no earlier time to contradict. "The previous punch must exist" is a separate rule and
`isEligibleForBatch` already owns it. This shipped as a real bug during the build and is now
pinned by tests in `scripts/test/clock.mts`. The database enforces neither.

**Crew pick their own time, and it snaps to the company's grid.** The picker is TWO `Select`s
(hour, and minutes generated from `roundingMinutes`) rather than `input[type="time"]`: iOS
ignores that control's `step` and offers every minute, which defeats the grid — and the same
control's intrinsic min-width overran its own dialog on a real phone. Offering only grid minutes
makes the rule structural instead of a correction applied afterwards.

**Crew can walk the show's days** (arrows in a light strip under the masthead, `?d=YYYY-MM-DD`).
A requested day is honoured only if it is genuinely a work day OF THAT SHOW, else it falls back
to today. The punch route takes the date from the TIMECARD's own work day and never from the
request, so the reachable days are exactly the days that person is staffed. This deliberately
loosens the original today-only rule (Dan, 2026-09-05 — crew need to fix a punch missed
yesterday); finalize is still the sign-off.

**`<ClockPunch key={selectedDate}>` is load-bearing.** It seeds punch rows into `useState`, which
initialises once, so navigating days reused the instance: the header updated from props while the
cells still held the PREVIOUS day's timecard ids, and punching silently wrote to the wrong day —
overwriting a real punch. Caught only by reading the database rather than the screen.

**A travel day replaces the punch grid with a banner**, mirroring `TimecardRow`. Without it
every cell is disabled showing "—" and the crew member sees six dead squares with nothing saying
why. Plain `is_travel_day` only — `travel_in_day`/`travel_out_day` are HYBRID days additive to
hours actually worked, so those still punch normally.

**Which cells are tappable is `isEligibleForBatch`, the same rule the server enforces**, never
"is this `nextPunchType`". An earlier version used the latter, which left Wrap dead until every
meal was filled in — and plenty of days have no second meal, so crew could not go home. `next`
survives purely as the VISUAL lit key; other legal punches sit in the ghost register.

**The crew screen is the tracker, for one person.** Same gesture (tap a punch cell → the
TimeEntryModal-shaped editor, pre-filled, Save), same vocabulary (ink `BAND` masthead, the
mobile tracker's 3-across punch grid, `RULE_MAJOR` closing), scaled up from `h-12` to `h-24`
because the whole phone serves one person. Two earlier cuts were rejected and are worth not
repeating: a bespoke "Tap to Start" button plus a separate "Different time" link (two
affordances for one action), and full-width rows inside a `Card`, which Dan read as "a little
small". The message screens (bad link, expired, closed out) keep the centred `Card`; the
working screens sit on the paper ground.

**`roundWallTime` is NOT the rounding `calculateNetHours` does, despite reading the same
`organizations.timecard_rounding_minutes`.** The payroll one ceilings a finished day's total NET
MINUTES; this one moves the punch itself. They give different answers, so do not "unify" them.
**Always UP to the next mark, never nearest** (Dan, 2026-09-04) — which does match the direction
`calculateNetHours` rounds, so the app only ever rounds one way. A time already on the grid does
not move. Note this is not uniformly in the crew member's favour: rounding a START up costs them
the difference, rounding a WRAP up pays them to the next mark; that is the policy, not a bug. It
rounds WALL CLOCK, not the instant, because a zone offset by :45 or :30 would otherwise land on
a clean quarter in UTC and an ugly one on the clock the crew member is reading.

**EVERY punch in the app goes through it** (Dan, 2026-09-04: "Every punch should land on the
organization time rounding rules. Everywhere."). There are exactly three places that build a
punch instant — `TimeEntryModal`, `BatchTimeModal` and `app/api/clock/punch` — and all three
round before calling `zonedWallTimeToUtc`, honouring the `dayOffset` it returns. A fourth writer
must do the same; `roundingMinutes` is a REQUIRED prop on the components that reach those modals
precisely so the compiler names every call site instead of a default silently hiding one. Both PM
modals say the rule out loud ("Recorded in 15-minute steps, always rounded up") and set the time
input's `step`, because save() moves the time somebody just typed and a PM who enters 8:07 and
finds 8:15 on the row deserves to have been told.

Other things that are load-bearing and were each verified:
- **The show's timezone decides "today"**, server-side, which is what stops a bookmarked link
  back-dating. `clockLinkExpiry` goes through `zonedWallTimeToUtc` for the same reason — a
  local-midnight version expires links mid-show for a Los Angeles show built on a UTC server.
- **Expiry is DERIVED from the show (`isClockLinkExpired`), never read from
  `clock_links.expires_at`.** The stored column goes stale the moment a show gets longer:
  `add_show_day` extends `shows.end_date`, so links minted earlier would expire BEFORE the show
  ends — locking the whole crew out on exactly the days they most need to clock out. Deriving it
  cannot drift; patching `add_show_day` would fix that one path and leave a trap for the next
  writer of `end_date`. Nothing is lost, because "stop working after the show" IS a property of
  the show and an early kill is already `revoked_at`. `expires_at` stays as a record of intent
  at mint time — **do not reintroduce `new Date(link.expires_at) < new Date()` as the gate.**
  Both directions are pinned by tests and were verified on dev: a link with a lapsed stored
  expiry still works while the show runs, and a link stops working once the show has ended.
- **`shows.finalized_at` is pre-checked before every write.** `punches_blocked_when_finalized`
  is a TRIGGER and the service role does **not** bypass triggers, so without it a crew member
  gets a raw 500.
- **Crew may change a punch they entered, never one a PM entered** — the whole point of
  `source`. `TimeEntryModal` and `BatchPunchBar` therefore stamp `source: 'staff'` on UPDATE as
  well as INSERT, so a PM correcting a crew time becomes its author.
- **POST only**, both routes, and both allowlisted in `proxy.ts` (`/clock`, `/api/clock`).
  Slack unfurls every link pasted into a channel, and these links exist to be pasted there.
- Service role means the `day_rate` column lockdown does not apply. `lib/clockSession.ts` uses
  explicit column lists and **never `select('*')`** — the same convention, and the same lack of
  a lint rule, as `lib/bookingInvite.ts`.

Still open: no rate limiting on the public write endpoint (nothing in this app has any).

### Already built — do not rebuild these

- **Scheduling (2026-07-28; in production since the 2026-08-06 cutover).** The whole workflow:
  - `/dashboard/schedule` — company-wide calendar, rooms×days grid on desktop, agenda on mobile. `lib/schedule.ts` holds the cross-show query.
  - **Positions** — `crew_call_positions`, one row per person per day, hung off a room. Built in the rooms×days grid on `/dashboard/shows/new` or from a room's ⋮ → Positions. `lib/crewCallGrid.ts` is the pure model; `lib/crewCall.ts` has `summarizeCall`/`describeCallSize` and the day-scope helpers.
  - **Handoff to a scheduler** — `shows.scheduler_id` / `call_approved_at`, approved from the show page, emails the scheduler. Requires at least one position.
  - **Booking requests** — `booking_invites`, emailed confirm/decline link at `/book/[token]` with no login, plus an SMS-ready text with deliberately no link. `booking_status` on `timecards` is `pencilled → invited → confirmed | declined`. A decline frees the position (partial unique index) while keeping the row.
  - **Filling positions** — `FillPositionPicker`, role-filtered, warns on same-day conflicts *within this organization only*. Reachable from the positions panel **and** from open-position rows in the tracker.

This list drifted badly once and sent a session off to re-implement finished work. If something here looks missing, search the repo before believing it.

- **Crew clock links (2026-09-04/05)** — the whole no-login punching workflow: `clock_links`
  (personal links + one venue QR per show), the Crew Clock panel on Edit Show with the
  Slack-ready list and the printable QR sheet, the public `/clock/[token]` page with day arrows,
  the two POST-only API routes, the tracker's crew-entered mark and the Final Report's count.
  See the dedicated section above before changing any of it.
- **Admin UI for user privileges** — `app/dashboard/team/` + `PermissionsEditor.tsx`, gated on `can_manage_users`.
- **`day_rate` column-level lockdown** — done, and this entry replaces a stale "not yet built" one that survived here after the work shipped. `authenticated` holds **no `SELECT` grant** on `timecards.day_rate` or `rate_cards.day_rate`; reads route through the `timecard_day_rates` / `crew_rate_cards_visible` SECURITY DEFINER views, which check the caller's permission per query. Re-verified on production 2026-07-27: a direct read returns `42501` for every account including admins, and the write side is guarded separately by `enforce_pay_rate_write_permission` (raises on UPDATE, silently drops the rate on INSERT so staffing still works). This is what makes "the PM never sees the numbers" a real boundary rather than a convention.
- **Multi-organization data model** — one login can hold memberships in several organizations, with separate permissions in each, and switch between them from the account menu. `memberships` is the source of truth; `profiles.organization_id` and the 18 `can_*` columns still exist as a derived mirror and are due to be dropped. See migrations 0001–0006.
- **Email report delivery via Resend** — the Final Report (`api/reports/final/route.ts`), which also locks the show.
- **"Join the Beta" interest form** — `/join-beta` + `api/beta-signup/route.ts`.
- **Per-crew timesheet Text/Share/Copy** — `SendHoursButton.tsx`.
- **Named payroll presets, Continuous Time, Pay As Half Day UI, room rename/delete, per-crew removal, show archiving, batch travel-day toggle, reset punches, Copy Crew, Add Day from the tracker** — all shipped.
- The whole Settings page: 24-hour time, Shoulder Surfer Mode, org-wide timecard rounding, AV Roles editor, payroll presets, Final Report recipients.

## Shipping migrations to production — the procedure (first run: the 2026-08-06 cutover, DONE)

**The 2026-08-06 cutover shipped everything**: migrations 0011–0016 applied to production
(verified: all 161 existing timecards backfilled to `booking_status='confirmed'`, zero nulls;
day_type column, crew_call_positions and booking_invites present; 16 rows in
schema_migrations), grants.sql regenerated from production — which closed the known drift, it
now carries booking_invites, crew_call_positions and the 0012/0015 column grants — and
`scheduling` merged to `main`, deploying the scheduling feature and the full Showbill/Open
Paper redesign to crewtracker.app. Backup taken first: `backups/crewtracker-2026-08-06*.sql`
(Dropbox-synced off this machine).

**The procedure below is reusable for every future migration.** In this order — each step
exists because of a specific failure mode:

1. **Fresh backup first**: `npm run db:dump`. backups/ is gitignored but Dropbox-syncs.
2. **`npm run db:migrate -- --status --prod`** to see the pending list, then
   **`npm run db:migrate -- --prod`**. Write and verify on dev first, always; the branch
   preview exercises dev, so a feature working on preview is the proof. Migrations are
   forward-only; the backup is the undo. If a migration writes to existing rows, say so in
   its header and verify the write with a read-only check afterwards.
3. **Immediately after: `npm run db:grants`, and commit the regenerated `scripts/sql/grants.sql`.**
   Order is critical — db:grants reads PRODUCTION, so running it before step 2 silently writes
   a grants.sql missing whatever the migration granted. Skipping it means the next database
   rebuild loses those grants and the affected queries return 42501.
4. **Only then merge/push to `main`** (the step that deploys crewtracker.app) and verify the
   live site — including a smoke test of whatever the new migrations enable, since production
   exercises them for the first time only after this deploy.

**Working rhythm after the cutover**: day-to-day work continues on the `scheduling` branch
(pushes there build a preview against dev); merging `scheduling` → `main` is the deliberate
act that ships to customers, and any pending migrations go through the steps above FIRST.

## Past incidents worth remembering

- **`npm run build` and `next dev` share `.next`, and building while the dev server runs makes
  every route 404.** The production build overwrites the dev manifests, so `next dev` then serves
  a tree it cannot resolve — the terminal still says "Ready in 331ms" and every page, including
  `/`, returns 404. It looks like a routing or middleware fault and is neither. Fix: stop the dev
  server, `rm -rf .next`, restart. Cost several detours in one session because the symptom
  (everything 404s) points nowhere near the cause (a build ran). If a change needs verifying in
  the browser AND a production build, do the browser pass first.

- **`next dev` blocks cross-origin dev resources, and the failure is a page that renders
  perfectly and does nothing.** Opening the dev server from a phone on the wifi
  (`http://192.168.x.x:3000` instead of localhost) got `Blocked cross-origin request to Next.js
  dev resource /_next/webpack-hmr`, which stops the dev runtime booting, so **React never
  hydrates** — the server-rendered HTML looks completely correct and every tap is dead. Cost a
  long session on the crew clock, where testing on a real phone is the entire point, and it
  survived several wrong theories (viewport meta, horizontal overflow, iOS touch handling, stale
  chunks) because the page *looked* fine and worked perfectly on localhost. `next.config.ts` now
  computes this machine's LAN addresses via `os.networkInterfaces()` and passes them as
  `allowedDevOrigins` — computed, not hard-coded, because DHCP changes the address and a stale
  literal fails in exactly the same silent way. **Dev only**: production has no HMR and ignores
  the setting entirely. If a page ever renders but nothing responds, check hydration first
  (`Object.keys(el).some(k => k.startsWith('__react'))`) before suspecting the UI.

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
