# Regression pass — 2026-07-26

A lot changed in one day, much of it in the payroll and permissions layers. This is the
checklist for working through it. Split so we're not both clicking the same buttons: Dan
takes the things that need human judgement, Claude takes the things that need a second
session or an API probe.

## What changed today

| Area | Change |
|---|---|
| Day rates | Now a property of the **show**, not the day — enforced by database triggers |
| Reports | Day Rate column added to CSV and PDF; ranges shown when a rate varies |
| Show access | Team members can be assigned to a show (previously impossible — invited users saw nothing) |
| Pay-rate permissions | `can_view_pay_rates` / `can_edit_pay_rates` now enforced **in the database**, not the UI |
| Add Day | Now atomic — one transaction instead of four separate writes |
| Room order | Consistent across all days of a show |
| Superadmin | Operator flag is now data; orgs can be suspended; invites can be revoked; member directory removed |

---

## Already verified — don't redo

- **Payroll math recomputed independently from the database** and matches the app:
  Test 1 = 8.00 hrs / **$650.00**; Test 2 = 46 ST + 16 OT = 62.00 hrs / **$4750.00**.
  (The $50 rise from this morning's $4700 is exactly Aiden Johnson's travel half-day at his
  new $600 rate — an independent calculation landing on Dan's own edit.)
- **Rate invariant holds on every show**: one rate per crew member per role, no splits.
- Direct API read of a rate returns `permission denied` **even for a full admin**; the
  permission-checked view returns it for that same admin.
- Anonymous access to `timecards` / `rate_cards` returns `401`.
- Flipping `can_view_pay_rates` off empties every money surface on the **same session** —
  the check runs per query, not at login.
- Rate **writes**: update refused with a readable message; a staffing insert carrying a
  smuggled rate succeeded with the rate dropped.
- Suspended org: direct URL to a show shows "Account suspended", no data, no nav.
- Org admin cannot self-promote to operator, promote anyone else, or lift their own suspension.
- Add Day rolls back completely when a later step fails — no orphaned day.

---

## Dan's list — judgement, real workflows, real devices

Things that need a human eye or a real device. **Production** unless noted.

### Payroll correctness — the part that actually matters
- [ ] Open a show with real punches. Do the ST / OT / DT hours match what you'd work out by hand?
- [ ] Check a **travel day** and a **half day** — are they paid the way you'd expect?
- [ ] If any show has a **short turnaround**, confirm it still flags and still pays as double time.
- [ ] Compare a report against a figure you already trust from a past show.

### Day rates
- [ ] Change one person's rate on one day. Confirm it changes on **every** day of that show.
- [ ] Confirm it does **not** change their rate on a different show.
- [ ] Someone with two roles on one show (e.g. Hal as A1 and L1): change one role's rate,
      confirm the other role is untouched.
- [ ] Staff someone onto a later day. Do they arrive at the show's existing rate?

### Reports and exports
- [ ] Export **CSV**, open it in Excel. Is the new **Day Rate** column (column C) where you
      expect, and does every later column still line up?
- [ ] Export **PDF**. Day Rate in the Crew Summary, `$X / day` under each name in the breakdown.
- [ ] Send a **Final Report** email. Attachments open, figures present, totals correct.
- [ ] **Send Hours** to a crew member — check the text on a phone. Still no dollar figures anywhere.

### Tracker
- [ ] Punch a full day through: start, meals, wrap. Times land where typed.
- [ ] **Batch actions** — Start All, Wrap All, batch travel day.
- [ ] **Reset a person's day**.
- [ ] **Add Day & Copy Crew**, then **Copy Crew from Day N**.
- [ ] Rooms in the same order on every day.
- [ ] Do it all again on **iPad** and on **phone** — the mobile tracker is a separate layout.

### Directory and team
- [ ] Import a CSV, export a CSV, edit a crew member's rates.
- [ ] Invite a team member. Assign them to a show via **Edit Show → Show Access**.
- [ ] Confirm they can actually open that show, and can't open one they aren't assigned to.

### Superadmin
- [ ] Sign in as `dan@theaudiosmith.com`. **Platform** link in the nav.
- [ ] Member counts and show counts look right per org.
- [ ] **Revoke** a pending invitation, confirm the link stops working.
- [ ] **Suspend** an org, sign in as one of its members, confirm the suspended screen.
- [ ] **Re-enable**, confirm they're back in immediately.

---

## Claude's list — needs a second session or an API probe

Requires Dan to sign Claude into production, or to log in as a second user.

### Permission boundaries, against production
- [ ] As a PM (`can_view_pay_rates` off): no rates anywhere — reports, Edit Show, directory, tracker.
- [ ] Same PM, direct API: read `timecards.day_rate` → must be refused.
- [ ] Same PM: try to **write** a rate → refused; try to staff crew → must still succeed.
- [ ] PM opening a show they are not assigned to → nothing.
- [ ] Anonymous probes against every sensitive table on production.

### Cross-organization isolation
- [ ] From org A's session, attempt to read org B's shows, timecards, crew, rate cards, presets.
- [ ] Attempt to assign a profile from another org to one of my shows.
- [ ] Attempt to read another org's rates through the permission-checked views.

### Data integrity after the day's changes
- [ ] Rate invariant across every show (re-run after Dan's testing).
- [ ] No orphaned work days, rooms without days, or timecards without rooms.
- [ ] `shows.end_date` agrees with the last work day everywhere.
- [ ] Every show's room ordering still consistent.
- [ ] Punch counts unchanged from before the day's work.

### Locked shows
- [ ] Finalize a show, attempt every write path via API — punches, timecards, rates, add day.
- [ ] Unlock, confirm writes work again.

---

## Known open — not bugs to find, already on the list

- **`work_days` has no UPDATE or DELETE policy.** Deleting a day through the app silently
  does nothing. No feature uses it yet.
- **Blank role shows as "Production Manager"** in role dropdowns instead of "No role".
- **`organizations.default_cc_email`** is orphaned — written by Settings, read by nothing.
- **Suspension blocks the app, not the database** — deliberate; a suspended customer's data
  is still theirs and an operator can lift it at any time.
