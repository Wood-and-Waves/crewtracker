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

## Design language

Pure black background, zinc-900 cards with ~20px corner radius, no borders, iOS system blue accents, bold white headers, gray secondary text. Sidebar nav on desktop, collapses to a floating pill-shaped bottom tab bar on mobile. Intentionally mirrors the iOS app's visual language.

**Known Safari gotcha:** native `<select>` elements need explicit `className="bg-zinc-800 text-white"` on every `<option>`, or text is invisible against the dark background in Safari. iPad Safari also has a hydration bug that can duplicate `<option>` elements in a controlled `<select>` — fix is a `key` prop on the `<select>` tied to a stable identifier of the options list (e.g. `key={options.map(o => o.id).join(',')}`) so React remounts instead of patching in place. Apply this pattern to any new dropdown.

## File structure

```
app/
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
  AppShell.tsx                 — responsive sidebar/tab-bar nav
  NewShowModal.tsx              — create show, auto-generates work_days
  AddRoomModal.tsx               — add room to a work day (optionally all remaining days); blocks duplicate room names on the same day
  RoomActionsMenu.tsx            — rename/delete a room (per-day, matches the room model)
  StaffRoomModal.tsx             — bulk staff crew into a room ("apply to all remaining days" defaults checked)
  TimecardRow.tsx / TimeEntryModal.tsx — punch rows + manual time entry w/ chronology validation
  BatchPunchBar.tsx              — room-level batch punch actions
  CrewDirectoryClient.tsx / EditCrewMemberClient.tsx
  EditShowClient.tsx             — all Edit Show fields batched into one Save button; Crew & Rates $ display respects Shoulder Surfer Mode
  ExportCSVButton.tsx / ExportPDFButton.tsx — gated by financials permission
  ArchiveShowButton.tsx / PersonalSettingsClient.tsx / OrgSettingsClient.tsx / AVRolesEditor.tsx
lib/
  supabase/client.ts / server.ts / admin.ts
  payroll.ts    — TypeScript port of iOS PayrollCalculator
  punches.ts    — punch ordering/labels + chronology validation; formatPunchTime takes a use24Hour flag
  invite.ts     — acceptInvite(): finalizes invite, seeds default av_roles for new orgs
proxy.ts        — auth middleware (protects all routes)
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

- SMS/text timesheet delivery (iOS has native SMS composer, no web equivalent)
- Email report delivery (iOS has native Mail composer; web would need something like Resend). `organizations.default_cc_email` already exists for this, just unused.
- Dark mode — **intentionally dropped, not just deferred.** The web app was built pure-black-only from day one; there's no light theme anywhere in the CSS, unlike iOS which had both. Dan explicitly does not want a toggle bolted on — he wants a full UI redesign at some point and isn't attached to the current look. Don't build a light theme without that being the explicit ask.
- Microsoft/Azure SSO, Capacitor iOS/Android wrapping, Stripe billing — all deferred
- Crew app access (crew role) — schema ready, UI deferred
- Room delete/rename, show archiving, and the Settings page (24-hour time, Shoulder Surfer Mode, org-wide timecard rounding, default CC email, AV Roles editor) are all built — see File structure above.

## Past incidents worth remembering

- Invite-seeding logic once fired twice for one org, creating duplicate `av_roles` rows — surfaced as doubled dropdown options on iPad Safari. Fixed via SQL cleanup + guarding on `existingRoleCount` before seeding.
- `TimeEntryModal` used to default new punches to the browser's real-world "today" instead of the show-day being viewed — silently produced a 33.5-hour day and broke short-turnaround detection. Fixed (see [components/TimeEntryModal.tsx](components/TimeEntryModal.tsx)).
- Same bug, different spot: the tracker console picked "today" via `new Date().toISOString()` (UTC), which rolls to tomorrow's date in the evening in any US timezone — opened the wrong day by default. Fixed by computing today's date via `Intl.DateTimeFormat('en-CA', { timeZone })`. **Any "what day is it" logic in this app must derive from the show's timezone, never from UTC or raw `Date()` — this class of bug has now recurred twice.**
- `AddRoomModal` had zero uniqueness check, so the same room name could be added twice to one day. Fixed by checking existing room names (case-insensitive, per work_day_id) before inserting.
- `totalPay` initially miscalculated by multiplying straight-time hourly instead of using the flat day-rate guarantee — corrected against the real Swift source.
- RLS was originally SELECT-only on most tables; INSERT/UPDATE/DELETE policies were retrofitted per table as each feature hit a wall. **Do not assume a new table has full RLS coverage.**

## Environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, never expose to browser) — in `.env.local` and Vercel project settings.

## Notes

- Supabase free tier pauses projects after 7 days of inactivity — unpause from the dashboard.
- `crewtracker-lime.vercel.app` is the stable production URL; deployment-specific preview URLs are not.
