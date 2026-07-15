# Team / Admin Privileges — Design Spec

## Problem

The `profiles` table already has a `base_role` column (admin/staff/pm/crew) plus 18 individual permission booleans, customizable per user. But there is no UI for an admin to actually set them:

- `can_manage_users` currently only gates two fields on the org-wide Settings page — it doesn't unlock a per-user editor.
- The only invite-creation path in the app (`app/api/admin/create-invite/route.ts`) is hardcoded to a single superadmin user ID and always creates a brand-new organization with every permission set to `true`. There is no way for an org's own admin to invite an additional teammate into their own org.
- RLS on `profiles` only allows a user to update their own row — an admin cannot edit anyone else's permissions today even via direct Supabase calls.

This spec covers building the admin-facing screen and the access-control changes needed to support it. **Explicitly out of scope:** actually wiring up enforcement checks for the permissions that don't do anything yet (see "Current enforcement reality" below) — that is a separate spec/project, planned to follow immediately after this one.

## Current enforcement reality (informs scope, not something this spec changes)

Of the 18 permission columns, only 3 are checked anywhere in the app today:
- `can_manage_users` — gates two sections on the Settings page
- `can_archive_shows` — gates the "Archive Show" option on the dashboard
- `can_view_pay_rates` — gates whether $ figures show on the reports page

4 columns are not used anywhere and are excluded from this spec's UI entirely (still written to the database with sensible preset values, just never shown as toggles): `can_manage_billing`, `can_view_crew_contacts`, `can_duplicate_shows`, `can_approve_timecards`.

The remaining 11 visible-but-currently-inert columns (`can_manage_crew_directory`, `can_import_crew`, `can_create_shows`, `can_edit_all_shows`, `can_edit_timecards`, `can_edit_pay_rates`, `can_manage_rulesets`, `can_view_reports`, `can_export_reports`, `can_send_reports`, `view_only`) are shown in this spec's UI and save correctly to the database, but do not yet restrict or unlock anything in the app. Wiring up their enforcement is the next spec.

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
- **Advanced section:** collapsed by default, an expandable list of 14 individual `Toggle` switches (all 18 columns minus the 4 permanently-hidden ones), each labeled in plain English (e.g. "Manage Users", "View Pay Rates", not the raw column name). Flipping any toggle here edits the in-memory value directly, independent of the role picker above (the role picker's displayed selection does not un-highlight if you diverge from its preset — it simply reflects "the role last chosen," not "current state matches this preset").

### Preset table

| Permission | Admin | Staff | PM |
|---|---|---|---|
| Manage users | ✅ | ❌ | ❌ |
| Manage crew directory | ✅ | ❌ | ✅ |
| Import crew | ✅ | ❌ | ❌ |
| Create shows | ✅ | ❌ | ✅ |
| Edit all shows | ✅ | ❌ | ❌ |
| Archive shows | ✅ | ❌ | ❌ |
| Edit timecards | ✅ | ✅ | ✅ |
| Approve timecards (hidden, not a toggle) | ✅ | ❌ | ✅ |
| View pay rates | ✅ | ❌ | ✅ |
| Edit pay rates | ✅ | ❌ | ❌ |
| Manage rulesets | ✅ | ❌ | ❌ |
| View reports | ✅ | ✅ | ✅ |
| Export reports | ✅ | ❌ | ✅ |
| Send reports | ✅ | ❌ | ✅ |
| View only | ❌ | ❌ | ❌ |
| Manage billing (hidden, not a toggle) | ✅ | ❌ | ❌ |
| View crew contacts (hidden, not a toggle) | ✅ | ❌ | ✅ |
| Duplicate shows (hidden, not a toggle) | ✅ | ❌ | ❌ |

(Rows marked "hidden, not a toggle" are still written to the database by the preset; they just never appear as an editable toggle in the Advanced section, per the "current enforcement reality" section above.)

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

**New RLS UPDATE policy on `profiles`**, mirroring the existing, already-proven `invitations` policy shape:

```sql
create policy "Admins can manage org member permissions"
on profiles for update
using (
  organization_id = my_organization_id()
  and (select can_manage_users from profiles where id = auth.uid())
)
with check (
  organization_id = my_organization_id()
);
```

**New `BEFORE UPDATE` trigger** on `profiles` (matching the existing trigger pattern used for `handle_new_user` / `handle_new_organization`), enforcing both safeguards regardless of what caller attempted the update:
- Raises an exception if the row being updated has `id = auth.uid()` (a self-edit) and the update would change `can_manage_users` from `true` to `false`.
- Raises an exception if the row being updated currently has `can_manage_users = true`, the update would set it to `false`, and no other row in the same `organization_id` has `can_manage_users = true`.

Both are real Postgres errors surfaced to the calling code as a normal Supabase error — not a silent no-op, per this project's standing "surface errors, never fail silently" rule.

## Error handling

Standard pattern already used elsewhere in this app (e.g. `EditShowClient.tsx`): a failed save shows an inline error banner, the form stays filled so nothing is lost, no silent failures.

## Out of scope (explicitly, for this spec)

- Enforcement of the 11 currently-inert permissions across their respective features (show creation, timecard editing, crew directory, report export, rulesets, pay rate edits, `view_only` global mode) — separate follow-up spec.
- Removing/deactivating a user from an org entirely (not asked for; only role/permission editing and inviting new members).
- Crew role assignment (crew app access isn't built).
