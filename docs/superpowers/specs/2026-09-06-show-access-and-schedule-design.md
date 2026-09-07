# Show access, crew-side logins, and the schedule grid — design

Decided with Dan, 2026-09-06. Five sections, in build order. Sections 1, 2, 3 and 5 ship as
one cutover; Section 4 ships on its own afterwards.

## Why

- A PM should see only the shows they are on; a salesperson builds a show, staffs it, assigns
  the PM and sends it to scheduling. (Mostly exists today: the assignment door in the shows
  visibility rule, and Edit Show → Show Access.)
- The same person is a PM on one show and an A1 on another. Today what a login may do is
  decided per COMPANY, so a PM given access to a show they are crew on gets PM powers there.
- Not everyone works the same days. The data already stores a person one day at a time
  (a timecard per person × room × day, travel flags on it); entering that takes three screens.

## Decisions (Dan's answers, verbatim where it matters)

| Question | Answer |
|---|---|
| What can a crew-side login do on a show? | **See only their own days and punch their own times** — the crew clock, from a login. |
| How does a login connect to a directory entry? | **Automatically by email** ("email is what will drive the crew logon"), with guard rails. |
| Per-show roles? | **None to pick.** PM = on the access list (or creator/scheduler). Crew = staffed. "Anyone that is on the show and needs to see everyone will have global access." |
| What does crew-side see when opening a show? | **The crew clock screen**, reached from the login instead of a link. |
| How do crew get a login? | **Not this round.** Build the model; the invite path comes later. |
| Where does staffing-with-days live? | **A crew × days grid on Edit Show**; the tracker's Staff room stays for on-site changes. |
| Rooms in the grid? | **Pick the room at the top; each tapped cell goes into it.** |
| Unlock a finalized show? | **Admins and the show's PM** (creator, scheduler, or on the access list). |
| Grid platform | **Desktop first** — "I can't imagine staffing an entire show from an iPhone." Decent on a phone. |

---

## Section 1 — Connecting logins to directory entries

**Data.** `crew_members.profile_id uuid null references profiles(id) on delete set null`,
plus a unique partial index `(organization_id, profile_id) where profile_id is not null` — one
directory entry per login per company.

**Automatic matching**, always inside ONE organization, case-insensitive on email:

- When a membership is created (invite accepted) → find `crew_members` in that organization
  whose lower(email) = the profile's lower(email) and `profile_id is null`. Exactly one →
  set it. Zero or several → do nothing.
- When a `crew_members` row is inserted or its `email` changes → find that organization's
  memberships whose profile email matches (deactivated excluded). Exactly one → set it.
  Also clear `profile_id` when the email is changed to something that no longer matches the
  linked profile.
- One backfill pass at migration time with the same rule.

Implemented as SECURITY DEFINER trigger functions (`link_crew_member_by_email`), because the
lookup reads across `profiles`/`memberships`, and as a plain SQL function
`relink_crew_member(crew_member_id)` the app can call. Never matches across organizations:
the search is always scoped by `organization_id`, so Company B's entry for a person links only
to that person's membership in B.

**UI.** Edit Crew (`EditCrewMemberClient`) shows a "Login" row: the linked email with an
Unlink (✕) button, or "No login" — or, when two or more entries share the email, "Two people
in the directory share this email, so no login is linked. Fix the emails to link one." Unlink
sets `profile_id = null`; re-linking happens automatically if the email is edited to a unique
match. Gated on `can_manage_crew_directory` like the rest of the page.

Nothing else reads `profile_id` until Section 2.

## Section 2 — Who sees what on a show

**The new door.** A show is visible when (today) `can_see_all_shows()` OR created_by OR
scheduler_id OR on `show_assignments` — OR (new) **the caller's linked directory entry has a
live timecard on it.**

The shows policy must not read `timecards` (timecards' policy reads shows: the recursion trap
in CLAUDE.md). So a bookkeeping table, same pattern as `show_assignments.organization_id`:

```
show_crew_access (show_id uuid, profile_id uuid, organization_id uuid, primary key (show_id, profile_id))
```

Maintained by triggers, never by the app:

- `timecards` AFTER INSERT / UPDATE OF crew_member_id, booking_status, show_id / DELETE →
  recompute rows for the affected (show, profile) pairs: a row exists iff some timecard on
  that show has `crew_member_id` whose `crew_members.profile_id` is that profile and
  `booking_status <> 'declined'`.
- `crew_members` AFTER UPDATE OF profile_id → recompute for every show that member is on.
- Backfill at migration (empty today: no links exist yet).

Its SELECT policy is `profile_id = (select auth.uid())` — it references nothing else, so no
cycle. The shows policy gains `or id in (select show_id from show_crew_access where
profile_id = (select auth.uid()))`.

**PM-side vs crew-side.** A helper `my_pm_show_ids()` (STABLE, SECURITY DEFINER, `set
search_path`) returns the ids of shows the caller is PM-side on:
`can_see_all_shows()` → every show in the organization; else the union of created_by,
scheduler_id and `show_assignments` for the caller. Used only as `in (select
my_pm_show_ids())` so it is a hashed subplan evaluated once, never per row.

A helper `my_crew_member_ids()` returns `crew_members.id` where `profile_id = auth.uid()`
(all organizations the caller is in — but every policy that uses it also scopes by show, and
shows are organization-scoped, so nothing crosses).

**Row filtering.** Today `timecards`/`punches` SELECT is `show_id in (select id from shows)`.
It becomes:

```
show_id in (select id from shows)
and ( show_id in (select my_pm_show_ids())
   or crew_member_id in (select my_crew_member_ids()) )       -- timecards
```

and for punches, `show_id in (select id from shows) and timecard_id in (select id from
timecards)` — punches follow their timecard's visibility. `rooms` and `work_days` stay
show-visible (room names are not sensitive and the crew screen needs them).

The two SECURITY DEFINER rate views already carry their own rule (PM-side arms only); a
crew-side viewer gets no rates from them, which is correct.

**Writes.** `is_own_timecard(timecard_id)` becomes real: `exists (select 1 from timecards t
join crew_members cm on cm.id = t.crew_member_id where t.id = $1 and cm.profile_id =
auth.uid())`. The punch write policies already read `(select my_perm('can_edit_timecards'))
or is_own_timecard(timecard_id)`; the visibility change above means a PM-permission holder
who is crew-side on a show can only reach their own rows there anyway. Timecard writes stay
`can_edit_timecards` only (staffing is a PM's act); a crew-side person cannot change their
own flags.

**Role preset.** `crew` in `lib/permissions.ts`: every permission false, `view_only` false.
Not assigned by anything yet.

**No change for existing users.** With zero links, `show_crew_access` is empty,
`my_crew_member_ids()` is empty, and every rule reduces to today's.

## Section 3 — What crew-side people see

- **Dashboard.** The shows query already returns only visible shows. For a caller with no
  PM-side shows and no company permissions, the Staffing column, archive tab and "+ New Show"
  are already permission-gated; verify and gate any that are not.
- **Opening a show.** `app/dashboard/shows/[id]/page.tsx` asks: is this show in
  `my_pm_show_ids()`? (Fetched once alongside the show; a small RPC.) PM-side → the tracker.
  Crew-side → render the crew screen: `lib/clockSession.ts` gains `loadClockViewForProfile
  (showId, profileId, requestedDate?)` that resolves the caller's `crew_members` row in the
  show's organization and builds the same `ClockView` the token path builds; `ClockPunch`
  is reused unchanged except that its write goes to a new `POST /api/clock/punch-me` which
  authenticates by session instead of token and applies every rule the token route applies
  (shared into a `lib/clockPunch.ts` so the two routes cannot drift). No expiry state.
- **Reports, Edit Show, print QR** for a crew-side caller: `redirect()` to the show page.
- **Crew clock link + login for the same person**: both work; both write the same rows with
  `source = 'crew'`.

Deferred: any way for crew to obtain a login.

## Section 4 — The schedule grid (Edit Show → Schedule)

**Desktop first.** Designed and verified at 1440×900 with a 10-day run and 30 crew; must be
usable, not optimised, at phone widths (horizontal scroll inside the grid, never the page).

**Same family as New Show's grid.** New Show's positions grid is rooms × days; this is
people × days with a room per cell — same day headers with day-type tints, same squared
cells, same ruled section, so one teaches the other. It lives on Edit Show because a
person's day is a timecard row and timecards cannot exist before the show does; New Show's
finish action lands on the new show's Schedule section so the flow reads details → rules →
rooms/positions → schedule.

**Layout.** A ruled section on Edit Show titled **Schedule**. Header row: the show's days
(short weekday + date, tinted by day type, as the positions grid does). One row per staffed
person: name and role at left (rate is NOT shown here — rates have their own place and
permission). Cells are squares; a row reads as that person's run.

**Room picker** above the grid: "Room ▾" listing the show's rooms (union across days); hidden
when the show has one room. Each filled cell shows its room's two-letter initials; hovering
shows the name. Column headers dim on days the selected room does not exist.

**Cell states and the tap cycle:** empty → Work → Travel In → Travel Out → Travel → empty.
Right-click / long-press opens a small menu with the five states plus "Clear". Keyboard:
arrow keys move, space cycles, Esc closes the menu.

**What a cell writes** (immediately, verified, optimistic with revert — the tracker's flag
pattern):

| From → to | Write |
|---|---|
| empty → any | insert `timecards` (room = selected room on that day, crew_member_id, name, role; rate inherited by the show-wide trigger) with the state's flags |
| any → any (non-empty) | update the flags on that timecard: Work = all false; Travel In = travel_in_day; Travel Out = travel_out_day; Travel = is_travel_day |
| any → empty | **refused if the timecard has punches** ("Clear Wednesday's punches first"); else delete the timecard |
| into a room-day that doesn't exist | create the room on that day first (`rooms` insert), then the timecard; toast "Breakout A added to Monday" |

A cell whose timecard sits in a room other than the selected one, when tapped, MOVES to the
selected room (update `room_id`) — refused if punches exist, same message. Rooms are never
deleted from the grid.

**Adding a person:** "+ Add crew" opens the existing directory picker (name, role, rate — the
same fields as Staff room). Default fill: every show day as Work in the selected room; if the
person's first/last day are not the show's first/last day, nothing is guessed about travel.
(Dan's grid is where travel gets set; guessing wrong is worse than a blank.)

**Absence** (no-show / cancelled, 0027) is NOT a grid state — it is set on the tracker on the
day it happens; the grid shows such a cell with a muted glyph and does not cycle it.

**Locked show** (finalized): the grid is read-only with the standard note.

**Positions** (scheduling module): untouched. The grid is about people, positions are about
demand; a later pass may overlay open positions per day.

## Section 5 — Unlock after a Final Report

Allowed for `can_manage_users` OR PM-side on the show. `UnlockShowButton` is shown only to
them; migration adds `guard_show_unlock()` BEFORE UPDATE OF finalized_at ON shows: when
`old.finalized_at is not null and new.finalized_at is null`, raise unless
`my_perm('can_manage_users') or shows.id in (select my_pm_show_ids())`. Copy: "An admin or the
show's PM can unlock it."

## Section 6 — Migrations, tests, order

**Migrations** (dev first; `rls.mts` green; harness; then backup → `--prod` → `db:grants` →
`db:schema` → merge):

- 0028 — Section 1: `crew_members.profile_id`, index, link functions/triggers, backfill.
- 0029 — Section 2: `show_crew_access` + triggers + policy, `my_pm_show_ids()`,
  `my_crew_member_ids()`, `is_own_timecard()` real, shows/timecards/punches policies.
  Column grants: none new (timecards is column-granted; no new column).
- 0030 — Section 5: `guard_show_unlock()`.
- Section 4: no schema.

**Tests** (`scripts/test/rls.mts`, real signed-in sessions), new fixtures: `sam` — a login
in org A with the `crew` preset, linked by email to a directory entry staffed on `showA`
(one timecard + punch) and on `showA2` as PM (assignment). Checks:

1. matching links exactly-one, not zero, not two (two entries sharing an email → neither linked)
2. matching never crosses organizations (same email in org B stays unlinked to sam)
3. unlink removes the show from sam's view immediately
4. sam sees showA and only their own timecard/punches there; not alice's
5. sam can insert/update/delete their own punch on showA; not another's (0 rows / 42501)
6. sam cannot update their own timecard flags on showA
7. sam sees all of showA2 (PM-side via assignment) including others' timecards
8. sam gets no rates from `timecard_day_rates` on showA; does on showA2 if permitted
9. declining sam's booking on showA removes the show from sam's view (trigger on booking_status)
10. a view-only member and dave (assigned PM) are unchanged by all of the above
11. unlock: dave (PM-side) can; carol (view_only) cannot; sam (crew-side) cannot; alice (admin) can
12. cost harness: the punch read stays ~1–2 ms; no per-row helper filters.

`payroll.mts`: unchanged. `clock.mts`: the shared `lib/clockPunch.ts` rules pinned once for
both routes.

**Order of work:** Sections 1 → 2 → 3 → 5 (one cutover, invisible until a link exists), then
Section 4 as its own cutover with a first cut for Dan to react to.

**Out of scope this round:** crew invite path; a Viewer role; change notices to crew;
branding; positions overlay on the grid.
