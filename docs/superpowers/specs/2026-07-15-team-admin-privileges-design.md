# Team / Admin Privileges — Design Spec

## Problem

The `profiles` table already has a `base_role` column (admin/staff/pm/crew) plus 18 individual permission booleans, customizable per user. But there is no UI for an admin to actually set them:

- `can_manage_users` currently only gates two fields on the org-wide Settings page — it doesn't unlock a per-user editor.
- The only invite-creation path in the app (`app/api/admin/create-invite/route.ts`) is hardcoded to a single superadmin user ID and always creates a brand-new organization with every permission set to `true`. There is no way for an org's own admin to invite an additional teammate into their own org.
- RLS on `profiles` only allows a user to update their own row — an admin cannot edit anyone else's permissions today even via direct Supabase calls.

This spec covers building the admin-facing screen and the access-control changes needed to support it. **Explicitly out of scope:** actually wiring up enforcement checks for the permissions that don't do anything yet (see "Current enforcement reality" below) — that is a separate spec/project, planned to follow immediately after this one.

## Current enforcement reality (informs scope, not something this spec changes)

**Correction from an earlier pass of this investigation:** the first check only searched application TypeScript code and missed enforcement that lives in Postgres RLS policies. The accurate picture, checked directly against `pg_policies`:

Enforced somewhere today:
- `can_manage_users` — gates two sections on the Settings page (app code), plus RLS on `invitations` (`ALL`) and `organizations` (`UPDATE`)
- `can_archive_shows` — gates the "Archive Show" option on the dashboard (app code)
- `can_view_pay_rates` — gates whether $ figures show on the reports page (app code)
- `can_manage_crew_directory` — RLS on `crew_members` (`ALL`)
- `can_create_shows` — RLS on `shows` (`INSERT`)
- `can_manage_billing` — RLS on `subscriptions` (`UPDATE`)
- `can_edit_all_shows` — indirectly, via the `can_see_all_shows()` SQL function, which gates the `shows`/`show_assignments` `SELECT` policies (see "Show visibility" section below) — this is about *which shows you can see*, not about editing them
- `can_edit_timecards` — RLS on `shows` (`UPDATE`), though this is a naming mismatch worth flagging: this permission gates editing the *show record itself* (name, venue, dates, etc.), not timecards/punches, which have no permission check at all beyond org membership (see "Show visibility" section)

Genuinely unused anywhere, excluded from this spec's UI entirely (still written to the database with sensible preset values, just never shown as toggles): `can_view_crew_contacts`, `can_duplicate_shows`, `can_approve_timecards`. (`can_manage_billing` was previously assumed to be in this group — it is not; it's a real, enforced permission and is included as a visible toggle below.)

`view_only` is also inert today, and is **deliberately hidden** in this spec (set by presets to `false`, but never shown as a toggle). Its label implies a hard "this user can only look, never edit" lock — but nothing enforces that yet, so exposing it would mislead an admin into believing a user is restricted when they are not. It becomes a visible toggle only once the next spec actually enforces it.

The remaining currently-inert columns (`can_import_crew`, `can_edit_pay_rates`, `can_manage_rulesets`, `can_view_reports`, `can_export_reports`, `can_send_reports`) are shown in this spec's UI and save correctly to the database, but do not yet restrict or unlock anything in the app. Wiring up their enforcement (and `view_only`'s) — along with extending write-side visibility scoping to rooms/timecards/punches/rate_cards/rulesets — is the next spec.

## Show visibility (existing behavior, one bug fixed here)

While reviewing this, a related concern came up: does a PM only see shows they're assigned to or created, not every show in the org? **This already works correctly for viewing shows** — no new code needed. The `shows` table's `SELECT` policy already restricts visibility to: assigned (via `show_assignments`), OR created by you, OR you have `can_edit_all_shows` (via the `can_see_all_shows()` function). Rooms, timecards, punches, and work days all correctly inherit this same visibility for viewing, since each cascades through a chain of RLS policies that bottoms out at this `shows` policy.

**Two real problems with `shows` writes, both fixed in this spec's migration:**

1. The `shows` table has two `UPDATE` policies. The intended one is named `"Users can update shows they can see"` but the second, leftover policy (`"Users update shows in their org"`) has no permission check at all beyond organization match. RLS policies for the same command are OR'd together, so the permissive one silently wins — meaning any org member can currently update any show's info via a direct request, regardless of assignment or permissions.

2. Worse, the *intended* policy is itself misnamed: despite being called "shows they can see," its condition is only `organization_id match AND can_edit_timecards` — it does **not** check assignment/creator/can-edit-all. So even after dropping the leftover policy, a user with `can_edit_timecards` could still edit *any* show in the org, including one they can't see (e.g. PM A editing PM B's show via a direct request).

This spec drops the leftover policy **and** rewrites the remaining one so editing a show requires both the permission (`can_edit_timecards`) **and** visibility (assigned, creator, or `can_edit_all_shows`) — mirroring the read-side rule. This fully delivers the "PM A can't touch PM B's shows" requirement for shows, at both the view and write level. (SQL in "Data & access layer" below.)

**Explicitly deferred to the next spec:** applying the same assignment-aware visibility check to *writes* on the nested tables — rooms/timecards/punches/rate_cards/rulesets (today those only check organization membership, not assignment/creation/can-edit-all — narrower than the read side). Shows themselves are fully handled here; the nested-table write scoping is part of "wire up enforcement properly" and is scoped to the next spec rather than growing this one further.

## Roles in scope

Only `admin`, `staff`, and `pm` are assignable through this UI. `crew` is excluded — crew members don't have real app access yet (separate, already-known gap), so surfacing it as an assignable role here would be misleading.

## Screens & navigation

- `AppShell.tsx` gets a new nav item — "Team" — in both the desktop top-nav (≥1024px) and the mobile bottom-tab-bar (<1024px). It is only rendered when the logged-in user's `can_manage_users` is `true` (same pattern already used to gate sections of the Settings page).
- New route `app/dashboard/team/page.tsx` (server component) — re-checks `can_manage_users` server-side and redirects (e.g. to `/dashboard`) if false. Hiding the nav link is not the only protection; the route itself is gated.
- New route `app/dashboard/team/[userId]/page.tsx` — the edit-member screen, same server-side re-check.

## Team list screen (`app/dashboard/team/page.tsx`)

Server component. Fetches all `profiles` rows where `organization_id` matches the admin's own org (already permitted by the existing SELECT policy "Users see profiles in their org" — no new read policy needed).

- **Desktop (≥1024px):** a real data table — Name, Email, Role badge, an edit action per row — following the same "desktop restructures, doesn't just stretch" principle already used for Crew Directory.
- **Mobile (<1024px):** tappable rows collapsing to cards, matching Crew Directory's mobile treatment.
- Each row links to `/dashboard/team/[userId]`.
- An "Invite Teammate" button opens a modal component (not a separate page), matching the existing modal pattern used by `NewShowModal` / `StaffRoomModal`.

## Shared `PermissionsEditor` component (`components/PermissionsEditor.tsx`)

Used by both the Invite Teammate modal and the Edit Member screen. Props: current values (or defaults), an `onChange` callback.

- **Role picker:** Admin / Staff / PM. Selecting a role immediately applies that role's preset values to all 18 underlying permission fields (including the 4 not shown as toggles — see preset table below). Re-selecting a role after manual overrides resets to that role's preset again — switching roles is a "start over" action, it does not attempt to merge with prior manual overrides.
- **Advanced section:** collapsed by default, an expandable list of 14 individual `Toggle` switches (all 18 columns minus the 4 not shown — the 3 genuinely-unused ones plus `view_only`), each labeled in plain English (e.g. "Manage Users", "View Pay Rates", not the raw column name). Flipping any toggle here edits the in-memory value directly, independent of the role picker above (the role picker's displayed selection does not un-highlight if you diverge from its preset — it simply reflects "the role last chosen," not "current state matches this preset").

### Preset table

| Permission | Admin | Staff | PM |
|---|---|---|---|
| Manage users | ✅ | ❌ | ❌ |
| Manage billing | ✅ | ❌ | ❌ |
| Manage crew directory | ✅ | ❌ | ✅ |
| Import crew | ✅ | ❌ | ❌ |
| Create shows | ✅ | ❌ | ✅ |
| Edit all shows | ✅ | ❌ | ❌ |
| Archive shows | ✅ | ❌ | ❌ |
| Edit timecards | ✅ | ✅ | ✅ |
| View pay rates | ✅ | ❌ | ✅ |
| Edit pay rates | ✅ | ❌ | ❌ |
| Manage rulesets | ✅ | ❌ | ❌ |
| View reports | ✅ | ✅ | ✅ |
| Export reports | ✅ | ❌ | ✅ |
| Send reports | ✅ | ❌ | ✅ |
| View only (not a toggle, hidden until enforced) | ❌ | ❌ | ❌ |
| Approve timecards (not a toggle, unused) | ✅ | ❌ | ✅ |
| View crew contacts (not a toggle, unused) | ✅ | ❌ | ✅ |
| Duplicate shows (not a toggle, unused) | ✅ | ❌ | ❌ |

(The 4 rows marked "not a toggle" are still written to the database by the preset; they just never appear as an editable toggle in the Advanced section, per the "current enforcement reality" section above. `view_only` is held out because its implied read-only semantics aren't enforced yet; the other 3 because they're unused entirely.)

## Invite Teammate modal

Fields: Name (optional), Email (optional — matches the existing invite flow, which already supports email-less, link-shared invites), the shared `PermissionsEditor` (role + optional Advanced overrides).

On submit: inserts a row into `invitations` with `is_new_organization: false`, `organization_id` = the admin's own org, `base_role` and all 18 permission columns from the editor's current values. This uses the **existing** RLS policy "Admins can manage invitations" (`organization_id = my_organization_id() AND can_manage_users`) — no new policy or API route needed for this part; it's a direct authenticated-client insert, consistent with how the rest of the app writes data.

The resulting invite link (built from the returned `token`, same URL shape as `app/invite/[token]/page.tsx` already expects) is shown for the admin to copy — matching the existing superadmin invite screen's pattern.

The accept-side flow needs **no changes** — `lib/invite.ts`'s `acceptInvite()` already branches correctly on `is_new_organization` and applies `organization_id` + all permission columns from the invitation row either way.

## Edit Member screen (`app/dashboard/team/[userId]/page.tsx`)

Shows the person's name/email (read-only) and the shared `PermissionsEditor`, pre-filled with their current `base_role` derived selection and all 18 current values. Single "Save" button (batched save, matching `EditShowClient`'s pattern — not auto-saving per toggle).

Two safeguards, enforced in the UI **and** at the database level (next section):
- If the viewed user is the logged-in admin themselves, the "Manage Users" toggle is disabled with an explanatory caption — you cannot remove your own access this way.
- If saving would set `can_manage_users` to `false` on the org's last remaining `can_manage_users = true` row, Save is blocked client-side with an explanation before even attempting the write.

## Data & access layer

### ⚠️ Foundational fix: close the privilege self-escalation hole (must land in this spec)

**The problem (verified against the live database):** the `authenticated` Postgres role holds `UPDATE` on *every* column of `profiles` — including all `can_*` flags, `base_role`, and `organization_id` — and the only RLS gate today is the policy `"Users can update their own profile"` with `USING (id = auth.uid())` and a null `WITH CHECK` (which Postgres treats as "use the USING clause as the check"). That clause only checks that the row's `id` still equals the caller — it never restricts *which columns* changed. Net effect: **any logged-in user can set `can_manage_users = true` (or any other permission), or move themselves into another organization, on their own profile row via a direct Supabase call** — entirely outside this app's UI. This defeats the entire permissions model, so a permissions editor cannot ship on top of it without this fix.

Column-level `GRANT`s can't express "you may edit these columns but not those," so the fix lives in the trigger below (a trigger can compare `OLD` vs `NEW`).

### SECURITY DEFINER helper (matches existing `can_see_all_shows()` pattern)

```sql
create or replace function public.can_manage_users_me()
returns boolean
language sql stable security definer
set search_path = public
as $$ select can_manage_users from profiles where id = auth.uid(); $$;
```

Using a `SECURITY DEFINER` helper (exactly as `can_see_all_shows()` already does) instead of an inline `(select can_manage_users from profiles where id = auth.uid())` avoids evaluating a `profiles` subquery inside a `profiles` policy — sidestepping RLS-recursion fragility — and keeps the codebase consistent.

### New RLS UPDATE policy on `profiles`

Mirrors the existing, already-proven `invitations` policy shape, using the helper:

```sql
create policy "Admins can manage org member permissions"
on profiles for update
using (
  organization_id = my_organization_id()
  and can_manage_users_me()
)
with check (
  organization_id = my_organization_id()
  and can_manage_users_me()
);
```

This OR's with the existing self-update policy (RLS policies for a command are OR'd), which is intended: regular users keep editing their own personal-preference fields, admins can edit anyone in their org. The column-level protection for both paths comes from the trigger.

### New `BEFORE UPDATE` trigger on `profiles`

A single `SECURITY DEFINER` trigger function (matching the existing `handle_new_user` / `handle_new_organization` pattern) enforces three rules, regardless of what code path attempted the update:

1. **Self-escalation lock (the foundational fix above):** if the row being updated is the caller's own (`NEW.id = auth.uid()`) and the caller is **not** an admin (`can_manage_users` is not true for them), then none of the privileged columns may change — every `can_*` flag, `base_role`, and `organization_id` in `NEW` must equal `OLD`. Otherwise raise an exception. (A non-admin self-edit is thus limited to personal-preference columns like `use_24_hour_time`, `shoulder_surfer_mode`, `full_name`.)
2. **Self-demotion guard:** even an admin cannot remove their own `can_manage_users` (`NEW.id = auth.uid()` and `can_manage_users` goes `true → false`) — raise.
3. **Last-admin guard:** if any row's `can_manage_users` goes `true → false` and no *other* row in the same `organization_id` still has `can_manage_users = true`, raise.

**Service-role / invite-accept safety:** `acceptInvite()` (`lib/invite.ts`) writes profiles via the service-role client, which bypasses RLS but **not** triggers. Under a service-role call `auth.uid()` is `null`, so the trigger must early-return (skip all three actor-based checks) when `auth.uid() is null` — the service role is trusted. This interaction must be covered by an explicit test, since a wrong guard here would silently break invite acceptance.

All three rules raise real Postgres errors surfaced to the calling code as normal Supabase errors — not silent no-ops, per this project's standing "surface errors, never fail silently" rule.

*(Known minor edge case, not blocking: rules 2/3 are evaluated per-row, so two admins demoting each other in exactly-simultaneous transactions could theoretically both pass the "another admin exists" check and leave zero admins. Vanishingly unlikely for a small team; a `SELECT ... FOR UPDATE` lock would close it if it ever matters. Noted for the implementation plan, not required for v1.)*

### Fix `shows` write policies (delivers the PM-A-vs-PM-B requirement for writes)

Per "Show visibility" above, drop the leftover no-check policy **and** rewrite the intended one so editing a show requires both `can_edit_timecards` **and** visibility:

```sql
drop policy "Users update shows in their org" on shows;
drop policy "Users can update shows they can see" on shows;

create policy "Users can update shows they can see"
on shows for update
using (
  organization_id = my_organization_id()
  and (select can_edit_timecards from profiles where id = auth.uid())
  and (
    can_see_all_shows()
    or id in (select show_id from show_assignments where profile_id = auth.uid())
    or created_by = auth.uid()
  )
)
with check (
  organization_id = my_organization_id()
);
```

## Error handling

Standard pattern already used elsewhere in this app (e.g. `EditShowClient.tsx`): a failed save shows an inline error banner, the form stays filled so nothing is lost, no silent failures.

## Out of scope (explicitly, for this spec)

- Enforcement of the currently-inert permissions across their respective features (`can_import_crew`, `can_edit_pay_rates`, `can_manage_rulesets`, `can_view_reports`, `can_export_reports`, `can_send_reports`, `view_only`) — separate follow-up spec. (`view_only` also stays hidden from the UI until then.)
- Extending assignment-aware visibility scoping to *writes* on the nested tables — rooms/timecards/punches/rate_cards/rulesets (today those only check org membership, not assignment) — separate follow-up spec. **Shows themselves are handled in this spec** (both read and write).
- Gating `av_roles` writes on a permission (currently any org member can add/edit/delete the org's job-title list; no `can_*` check at all) — noted during the access-control sweep, folded into the next spec.
- Removing/deactivating a user from an org entirely, and surfacing/revoking *pending* (unaccepted) invitations (the Team list shows accepted members only; the invite link is shown once at creation). Not asked for in v1 — candidate follow-ups.
- Crew role assignment (crew app access isn't built).
