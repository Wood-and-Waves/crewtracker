# Team / Admin Privileges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a "Team" screen (gated to `can_manage_users`) that lets an org admin invite teammates into their own org and edit existing members' roles/permissions, and close a foundational privilege-self-escalation hole plus a show-write visibility bug in the database.

**Architecture:** A database migration adds the access-control layer (a SECURITY DEFINER helper, an admin UPDATE policy on `profiles`, a BEFORE UPDATE trigger enforcing three safety rules, and a rewrite of the `shows` UPDATE policies). A shared pure module (`lib/permissions.ts`) is the single source of truth for role presets and the visible-toggle list, consumed by a shared `PermissionsEditor` component used in both an Invite modal and an Edit Member page. Navigation and both routes are gated on `can_manage_users` server-side.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres + RLS), Tailwind v4 (Signal design tokens), the existing `components/ui/*` primitives.

**Process note (no automated test framework):** this repo has no Jest/Vitest — `package.json` exposes only `build`, `lint`, and `db:sql`. Per this project's conventions (CLAUDE.md: "Always run `npm run build` before considering a change complete" + verify features in a browser) and the precedent set by the shipped `2026-07-15-join-the-beta.md` plan, each task's verification is `npm run build` / `npx tsc --noEmit`, plus SQL verification via `npm run db:sql` for database work, plus real browser verification via the preview tools for UI. This is a deliberate, documented deviation from the skill's default automated-TDD steps.

**Single-database note:** this project uses ONE Supabase project (ref `nfrvxkwemtittrqboebl`) for everything — `DATABASE_URL` in `.env.local` points at it. Running the Task 1 migration via `npm run db:sql` therefore applies it to the **live** database immediately; there is no separate staging DB. This matches how every prior schema change in this project has been made. The migration is written to be idempotent and transactional so a re-run is safe.

## Global Constraints

- **Never hardcode a color** — use Signal design tokens as Tailwind utilities (`bg-surface`, `text-ink`, `text-muted`, `border-line`, `text-accent`, `bg-accent-wash`, `rounded-card`, `rounded-field`, `rounded-pill`). Compose from `components/ui/*` primitives (`Button`, `Card`, `Toggle`) rather than raw styled markup. (The pre-existing `app/superadmin/*` zinc styling is the sole exception in the codebase; do NOT copy it — new screens are token-driven.)
- **Roles assignable in the UI: `admin`, `staff`, `pm` only.** `crew` is excluded.
- **Visible permission toggles: exactly 14** — `can_manage_users`, `can_manage_billing`, `can_manage_crew_directory`, `can_import_crew`, `can_create_shows`, `can_edit_all_shows`, `can_archive_shows`, `can_edit_timecards`, `can_view_pay_rates`, `can_edit_pay_rates`, `can_manage_rulesets`, `can_view_reports`, `can_export_reports`, `can_send_reports`.
- **Hidden-but-preset-set columns: exactly 4** — `view_only`, `can_approve_timecards`, `can_view_crew_contacts`, `can_duplicate_shows` (written by presets, never shown as toggles).
- **Preset values are the exact table in the spec** (`docs/superpowers/specs/2026-07-15-team-admin-privileges-design.md`) — reproduced verbatim in Task 2.
- **`RESEND_API_KEY` / service-role keys are server-only** (not relevant to new code here, but do not introduce client-side secret reads).
- **Surface errors, never fail silently** — failed saves show a visible inline error; the form stays filled.
- **Shared component boundary:** `lib/permissions.ts` is a plain module (NO `'use client'`), safe to import from client components. (Past incident: never export non-component values from a `'use client'` file for a Server Component to import.)
- **Never commit `.env.local`.**

## File Structure

- Create: `scripts/sql/team-admin-privileges.sql` — the migration (helper fn, admin RLS policy, trigger + trigger fn, shows-policy rewrite). Idempotent, transactional.
- Create: `scripts/sql/verify-team-admin-privileges.sql` — structural verification queries (objects exist / old policy gone).
- Create: `scripts/sql/test-team-admin-privileges.sql` — behavioral tests (self-escalation blocked, self-demotion blocked), transaction-wrapped and rolled back.
- Create: `lib/permissions.ts` — role/permission types, preset table, visible-toggle list, `presetFor()`.
- Create: `components/PermissionsEditor.tsx` — shared role-picker + Advanced-toggles editor (`'use client'`).
- Create: `components/InviteTeammateModal.tsx` — invite modal using `PermissionsEditor` (`'use client'`).
- Create: `app/dashboard/team/page.tsx` — server component: gate + member list.
- Create: `components/TeamListClient.tsx` — client: data table (desktop) / cards (mobile) + Invite button.
- Create: `app/dashboard/team/[userId]/page.tsx` — server component: gate + load target member.
- Create: `components/EditMemberClient.tsx` — client: `PermissionsEditor` + Save + safeguards.
- Modify: `app/dashboard/layout.tsx` — fetch `can_manage_users`, pass to `AppShell`.
- Modify: `components/AppShell.tsx` — accept `canManageUsers` prop, conditionally show "Team" nav item.

---

### Task 1: Database migration — access-control layer

**Files:**
- Create: `scripts/sql/team-admin-privileges.sql`
- Create: `scripts/sql/verify-team-admin-privileges.sql`
- Create: `scripts/sql/test-team-admin-privileges.sql`

**Interfaces:**
- Produces (for later tasks): an RLS UPDATE policy `"Admins can manage org member permissions"` on `profiles` that lets a `can_manage_users` user update any profile row in their own org; a BEFORE UPDATE trigger `enforce_profile_permission_rules` on `profiles` enforcing (1) non-admin self-escalation lock, (2) self-demotion guard, (3) last-admin guard; a rewritten `shows` UPDATE policy requiring `can_edit_timecards` AND visibility. Task 5/6 rely on these being live.

- [ ] **Step 1: Write the migration SQL**

Create `scripts/sql/team-admin-privileges.sql`:

```sql
-- Team / Admin Privileges migration.
-- Idempotent + transactional: safe to re-run.
begin;

-- 1. SECURITY DEFINER helper: is the current user an admin?
--    Mirrors the existing can_see_all_shows() pattern; avoids a profiles
--    subquery inside a profiles policy (RLS-recursion footgun).
create or replace function public.can_manage_users_me()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select can_manage_users from profiles where id = auth.uid();
$$;

-- 2. Admin UPDATE policy on profiles. OR's with the existing
--    "Users can update their own profile" policy (that stays as-is).
drop policy if exists "Admins can manage org member permissions" on profiles;
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

-- 3. BEFORE UPDATE trigger enforcing the three safety rules.
create or replace function public.enforce_profile_permission_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean;
begin
  -- Service-role / no-auth context (e.g. invite acceptance runs as the
  -- service role, where auth.uid() is null): skip all actor-based checks.
  if actor_id is null then
    return new;
  end if;

  select can_manage_users into actor_is_admin from profiles where id = actor_id;

  -- Rule 1: self-escalation lock. A non-admin editing their OWN row may not
  -- change any privileged column (all can_*, base_role, organization_id).
  if new.id = actor_id and coalesce(actor_is_admin, false) = false then
    if new.can_manage_users        is distinct from old.can_manage_users
       or new.can_manage_billing        is distinct from old.can_manage_billing
       or new.can_manage_crew_directory is distinct from old.can_manage_crew_directory
       or new.can_import_crew           is distinct from old.can_import_crew
       or new.can_view_crew_contacts    is distinct from old.can_view_crew_contacts
       or new.can_create_shows          is distinct from old.can_create_shows
       or new.can_edit_all_shows        is distinct from old.can_edit_all_shows
       or new.can_archive_shows         is distinct from old.can_archive_shows
       or new.can_duplicate_shows       is distinct from old.can_duplicate_shows
       or new.can_edit_timecards        is distinct from old.can_edit_timecards
       or new.can_approve_timecards     is distinct from old.can_approve_timecards
       or new.can_view_pay_rates        is distinct from old.can_view_pay_rates
       or new.can_edit_pay_rates        is distinct from old.can_edit_pay_rates
       or new.can_manage_rulesets       is distinct from old.can_manage_rulesets
       or new.can_view_reports          is distinct from old.can_view_reports
       or new.can_export_reports        is distinct from old.can_export_reports
       or new.can_send_reports          is distinct from old.can_send_reports
       or new.view_only                 is distinct from old.view_only
       or new.base_role                 is distinct from old.base_role
       or new.organization_id           is distinct from old.organization_id then
      raise exception 'You cannot change your own role or permissions.';
    end if;
  end if;

  -- Rule 2: self-demotion guard. Even an admin cannot remove their own
  -- can_manage_users (primary lockout protection).
  if new.id = actor_id
     and coalesce(old.can_manage_users, false) = true
     and coalesce(new.can_manage_users, false) = false then
    raise exception 'You cannot remove your own user-management permission.';
  end if;

  -- Rule 3: last-admin guard (defensive belt-and-suspenders). If any row's
  -- can_manage_users goes true->false and no OTHER row in the same org still
  -- has it, block.
  if coalesce(old.can_manage_users, false) = true
     and coalesce(new.can_manage_users, false) = false then
    if (select count(*) from profiles
        where organization_id = old.organization_id
          and can_manage_users = true
          and id <> old.id) = 0 then
      raise exception 'This is the organization''s last admin; grant another admin first.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_permission_rules on profiles;
create trigger enforce_profile_permission_rules
before update on profiles
for each row
execute function public.enforce_profile_permission_rules();

-- 4. Fix shows UPDATE policies. Drop the leftover no-permission-check policy
--    AND rewrite the intended one to require BOTH can_edit_timecards and
--    visibility (assigned / creator / can_edit_all_shows).
drop policy if exists "Users update shows in their org" on shows;
drop policy if exists "Users can update shows they can see" on shows;
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

commit;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:sql -- scripts/sql/team-admin-privileges.sql`
Expected: output ends with `COMMIT — 0 row(s)` and no `SQL error:` line. (If it errors, do NOT proceed — report the exact error; a partial apply is impossible because the whole file is one transaction.)

- [ ] **Step 3: Write structural verification SQL**

Create `scripts/sql/verify-team-admin-privileges.sql`:

```sql
-- Expect: helper function present (1 row).
select proname from pg_proc
where proname = 'can_manage_users_me' and pronamespace = 'public'::regnamespace;

-- Expect: admin update policy present (1 row).
select policyname, cmd from pg_policies
where tablename = 'profiles' and policyname = 'Admins can manage org member permissions';

-- Expect: trigger present (1 row).
select tgname from pg_trigger
where tgrelid = 'profiles'::regclass and tgname = 'enforce_profile_permission_rules';

-- Expect: leftover permissive shows policy GONE (0 rows).
select policyname from pg_policies
where tablename = 'shows' and policyname = 'Users update shows in their org';

-- Expect: exactly ONE shows UPDATE policy, and its condition mentions show_assignments (1 row).
select policyname, qual from pg_policies
where tablename = 'shows' and cmd = 'UPDATE';
```

Run: `npm run db:sql -- scripts/sql/verify-team-admin-privileges.sql`
Expected: helper=1 row, admin-policy=1 row, trigger=1 row, leftover-policy=0 rows, shows-UPDATE=1 row whose `qual` text contains `show_assignments`.

- [ ] **Step 4: Write behavioral tests (transaction-wrapped, rolled back — mutates nothing)**

Create `scripts/sql/test-team-admin-privileges.sql`. These simulate a specific user by setting the JWT claim `sub` (which `auth.uid()` reads), inside a transaction that is rolled back. The trigger fires regardless of connecting role, so this exercises the real rule logic.

```sql
-- TEST A: a NON-admin cannot escalate their own permissions.
begin;
do $$
declare
  v_nonadmin uuid;
begin
  select id into v_nonadmin from profiles where coalesce(can_manage_users, false) = false limit 1;
  if v_nonadmin is null then
    raise notice 'TEST A SKIP: no non-admin profile exists to test with';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_nonadmin::text)::text, true);
  begin
    update profiles set can_manage_users = true where id = v_nonadmin;
    raise notice 'TEST A FAIL: self-escalation was NOT blocked';
  exception when others then
    raise notice 'TEST A PASS: blocked with "%"', sqlerrm;
  end;
end $$;
rollback;

-- TEST B: an admin cannot remove their OWN can_manage_users.
begin;
do $$
declare
  v_admin uuid;
begin
  select id into v_admin from profiles where can_manage_users = true limit 1;
  if v_admin is null then
    raise notice 'TEST B SKIP: no admin profile exists to test with';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  begin
    update profiles set can_manage_users = false where id = v_admin;
    raise notice 'TEST B FAIL: self-demotion was NOT blocked';
  exception when others then
    raise notice 'TEST B PASS: blocked with "%"', sqlerrm;
  end;
end $$;
rollback;

-- TEST C: a non-admin CAN still change a personal-preference column on self.
begin;
do $$
declare
  v_nonadmin uuid;
begin
  select id into v_nonadmin from profiles where coalesce(can_manage_users, false) = false limit 1;
  if v_nonadmin is null then
    raise notice 'TEST C SKIP: no non-admin profile exists to test with';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_nonadmin::text)::text, true);
  begin
    update profiles set use_24_hour_time = not use_24_hour_time where id = v_nonadmin;
    raise notice 'TEST C PASS: personal-preference self-edit allowed';
  exception when others then
    raise notice 'TEST C FAIL: personal-preference self-edit wrongly blocked: "%"', sqlerrm;
  end;
end $$;
rollback;
```

- [ ] **Step 5: Run the behavioral tests**

Run: `npm run db:sql -- scripts/sql/test-team-admin-privileges.sql`
Expected: the output includes `TEST A PASS`, `TEST B PASS`, and `TEST C PASS` (as NOTICE lines). If any prints `FAIL` (or `SKIP` because the DB has no non-admin/admin row), report it — a `FAIL` means the trigger logic is wrong and must be fixed before proceeding; a `SKIP` means the implementer must note that this rule needs browser verification in Task 6 instead.

Note: `set_config('request.jwt.claims', …, true)` relies on Supabase's `auth.uid()` reading the `sub` claim. If the runner errors on `set_config`/claims in this environment, report it — Rules 1/2 will instead be verified through the real app in Task 6, and this script can be left as documentation.

- [ ] **Step 6: Commit**

```bash
git add scripts/sql/team-admin-privileges.sql scripts/sql/verify-team-admin-privileges.sql scripts/sql/test-team-admin-privileges.sql
git commit -m "Add Team admin-privileges DB migration: self-escalation trigger, admin profiles policy, shows-write visibility fix"
```

---

### Task 2: `lib/permissions.ts` — role presets + visible-toggle model

**Files:**
- Create: `lib/permissions.ts`

**Interfaces:**
- Produces: `type Role = 'admin' | 'staff' | 'pm'`; `type PermissionKey` (union of all 18 column names); `type PermissionValues = Record<PermissionKey, boolean>`; `const ROLES: { value: Role; label: string }[]`; `const VISIBLE_PERMISSIONS: { key: PermissionKey; label: string }[]` (the 14, in order); `const HIDDEN_PERMISSION_KEYS: PermissionKey[]` (the 4); `const PERMISSION_PRESETS: Record<Role, PermissionValues>`; `function presetFor(role: Role): PermissionValues`. Tasks 3, 4, 6 consume these.

- [ ] **Step 1: Write the module**

Create `lib/permissions.ts` (a plain module — NO `'use client'`):

```ts
// Single source of truth for org-member roles and the permission matrix.
// Plain module (no 'use client') so it is safe to import from client
// components — see CLAUDE.md "Past incidents" on the client/server export rule.

export type Role = 'admin' | 'staff' | 'pm'

export type PermissionKey =
  | 'can_manage_users'
  | 'can_manage_billing'
  | 'can_manage_crew_directory'
  | 'can_import_crew'
  | 'can_view_crew_contacts'
  | 'can_create_shows'
  | 'can_edit_all_shows'
  | 'can_archive_shows'
  | 'can_duplicate_shows'
  | 'can_edit_timecards'
  | 'can_approve_timecards'
  | 'can_view_pay_rates'
  | 'can_edit_pay_rates'
  | 'can_manage_rulesets'
  | 'can_view_reports'
  | 'can_export_reports'
  | 'can_send_reports'
  | 'view_only'

export type PermissionValues = Record<PermissionKey, boolean>

export const ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'staff', label: 'Staff' },
  { value: 'pm', label: 'PM' },
]

// The 14 permissions shown as toggles, in display order, plain-English labels.
export const VISIBLE_PERMISSIONS: { key: PermissionKey; label: string }[] = [
  { key: 'can_manage_users', label: 'Manage users' },
  { key: 'can_manage_billing', label: 'Manage billing' },
  { key: 'can_manage_crew_directory', label: 'Manage crew directory' },
  { key: 'can_import_crew', label: 'Import crew' },
  { key: 'can_create_shows', label: 'Create shows' },
  { key: 'can_edit_all_shows', label: 'Edit all shows' },
  { key: 'can_archive_shows', label: 'Archive shows' },
  { key: 'can_edit_timecards', label: 'Edit timecards' },
  { key: 'can_view_pay_rates', label: 'View pay rates' },
  { key: 'can_edit_pay_rates', label: 'Edit pay rates' },
  { key: 'can_manage_rulesets', label: 'Manage rulesets' },
  { key: 'can_view_reports', label: 'View reports' },
  { key: 'can_export_reports', label: 'Export reports' },
  { key: 'can_send_reports', label: 'Send reports' },
]

// Set by presets but never shown as toggles (3 unused + view_only which is
// inert-but-dangerous-to-expose until the next spec enforces it).
export const HIDDEN_PERMISSION_KEYS: PermissionKey[] = [
  'view_only',
  'can_approve_timecards',
  'can_view_crew_contacts',
  'can_duplicate_shows',
]

// Exact preset matrix from the design spec. admin = full access.
export const PERMISSION_PRESETS: Record<Role, PermissionValues> = {
  admin: {
    can_manage_users: true,
    can_manage_billing: true,
    can_manage_crew_directory: true,
    can_import_crew: true,
    can_view_crew_contacts: true,
    can_create_shows: true,
    can_edit_all_shows: true,
    can_archive_shows: true,
    can_duplicate_shows: true,
    can_edit_timecards: true,
    can_approve_timecards: true,
    can_view_pay_rates: true,
    can_edit_pay_rates: true,
    can_manage_rulesets: true,
    can_view_reports: true,
    can_export_reports: true,
    can_send_reports: true,
    view_only: false,
  },
  staff: {
    can_manage_users: false,
    can_manage_billing: false,
    can_manage_crew_directory: false,
    can_import_crew: false,
    can_view_crew_contacts: false,
    can_create_shows: false,
    can_edit_all_shows: false,
    can_archive_shows: false,
    can_duplicate_shows: false,
    can_edit_timecards: true,
    can_approve_timecards: false,
    can_view_pay_rates: false,
    can_edit_pay_rates: false,
    can_manage_rulesets: false,
    can_view_reports: true,
    can_export_reports: false,
    can_send_reports: false,
    view_only: false,
  },
  pm: {
    can_manage_users: false,
    can_manage_billing: false,
    can_manage_crew_directory: true,
    can_import_crew: false,
    can_view_crew_contacts: true,
    can_create_shows: true,
    can_edit_all_shows: false,
    can_archive_shows: false,
    can_duplicate_shows: false,
    can_edit_timecards: true,
    can_approve_timecards: true,
    can_view_pay_rates: true,
    can_edit_pay_rates: false,
    can_manage_rulesets: false,
    can_view_reports: true,
    can_export_reports: true,
    can_send_reports: true,
    view_only: false,
  },
}

export function presetFor(role: Role): PermissionValues {
  return { ...PERMISSION_PRESETS[role] }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (This type-checks the whole project including the new module, even though nothing imports it yet.)

- [ ] **Step 3: Commit**

```bash
git add lib/permissions.ts
git commit -m "Add lib/permissions: role presets + visible-toggle model for Team editor"
```

---

### Task 3: `PermissionsEditor` component

**Files:**
- Create: `components/PermissionsEditor.tsx`

**Interfaces:**
- Consumes: `lib/permissions.ts` (`Role`, `PermissionKey`, `PermissionValues`, `ROLES`, `VISIBLE_PERMISSIONS`, `presetFor`).
- Produces: default-exported React component `PermissionsEditor` with props `{ role: Role; values: PermissionValues; onChange: (next: { role: Role; values: PermissionValues }) => void; lockedKeys?: PermissionKey[] }`. Tasks 4 and 6 render it as a controlled component (they own the `role`/`values` state and pass `onChange`).

- [ ] **Step 1: Write the component**

Create `components/PermissionsEditor.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Toggle from '@/components/ui/Toggle'
import { cn } from '@/lib/cn'
import {
  ROLES,
  VISIBLE_PERMISSIONS,
  presetFor,
  type Role,
  type PermissionKey,
  type PermissionValues,
} from '@/lib/permissions'

export default function PermissionsEditor({
  role,
  values,
  onChange,
  lockedKeys = [],
}: {
  role: Role
  values: PermissionValues
  onChange: (next: { role: Role; values: PermissionValues }) => void
  lockedKeys?: PermissionKey[]
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function selectRole(nextRole: Role) {
    // Applying a preset overrides all keys EXCEPT locked ones (which keep
    // their current value — e.g. an admin editing themselves can't lose
    // Manage Users just by picking a lower role).
    const preset = presetFor(nextRole)
    for (const key of lockedKeys) preset[key] = values[key]
    onChange({ role: nextRole, values: preset })
  }

  function toggleKey(key: PermissionKey, next: boolean) {
    onChange({ role, values: { ...values, [key]: next } })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Role picker */}
      <div>
        <p className="mb-2 text-sm font-semibold text-ink">Role</p>
        <div className="flex gap-2">
          {ROLES.map(r => {
            const active = r.value === role
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => selectRole(r.value)}
                className={cn(
                  'rounded-field border px-4 py-2 text-sm font-semibold transition-colors',
                  active
                    ? 'border-accent bg-accent-wash text-accent'
                    : 'border-line bg-surface text-muted hover:text-ink',
                )}
              >
                {r.label}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          Picking a role sets a standard set of permissions. Fine-tune below if needed.
        </p>
      </div>

      {/* Advanced toggles */}
      <div className="rounded-card border border-line">
        <button
          type="button"
          onClick={() => setAdvancedOpen(o => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ink"
        >
          Advanced permissions
          <span className="text-muted">{advancedOpen ? '−' : '+'}</span>
        </button>
        {advancedOpen && (
          <div className="border-t border-line px-4 py-3">
            {VISIBLE_PERMISSIONS.map(({ key, label }) => {
              const locked = lockedKeys.includes(key)
              return (
                <div key={key} className="flex items-center justify-between py-2">
                  <span className="text-sm text-ink">
                    {label}
                    {locked && <span className="ml-2 text-xs text-muted">(locked)</span>}
                  </span>
                  <Toggle
                    checked={values[key]}
                    onChange={next => toggleKey(key, next)}
                    disabled={locked}
                    label={label}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check + build**

Run: `npm run build`
Expected: build succeeds, no TypeScript/ESLint errors. (Visual/interaction verification happens in Tasks 5 and 6 where this component is mounted in real pages.)

- [ ] **Step 3: Commit**

```bash
git add components/PermissionsEditor.tsx
git commit -m "Add PermissionsEditor: shared role-picker + advanced-toggle editor"
```

---

### Task 4: `InviteTeammateModal` component

**Files:**
- Create: `components/InviteTeammateModal.tsx`

**Interfaces:**
- Consumes: `lib/permissions.ts` (`presetFor`, `Role`, `PermissionValues`), `components/PermissionsEditor.tsx`, `lib/supabase/client.ts` (`createClient`), `components/ui/Button.tsx`.
- Produces: default-exported React component `InviteTeammateModal` with props `{ organizationId: string; invitedBy: string; onClose: () => void }`. Task 5 renders it conditionally from the Team list.

**Note (verified against the live schema):** the `invitations` table has **no `full_name` column** (its columns are `id, token, organization_id, invited_by, email, base_role`, the 18 permission booleans, `is_new_organization, organization_name, accepted_at, expires_at, created_at`). So this modal does NOT collect a name — the invited person's name comes from their own signup metadata when they accept (`handle_new_user` reads `raw_user_meta_data->>'full_name'`). Collecting a name here would imply it's saved when it isn't. Only Email (optional) + the permission editor are collected.

- [ ] **Step 1: Write the component**

Create `components/InviteTeammateModal.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import PermissionsEditor from '@/components/PermissionsEditor'
import { presetFor, type Role, type PermissionValues } from '@/lib/permissions'

const inputCls =
  'w-full rounded-field bg-surface-2 border border-line px-4 py-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent'

export default function InviteTeammateModal({
  organizationId,
  invitedBy,
  onClose,
}: {
  organizationId: string
  invitedBy: string
  onClose: () => void
}) {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('pm')
  const [values, setValues] = useState<PermissionValues>(presetFor('pm'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')

  async function createInvite() {
    setSaving(true)
    setError('')
    const { data, error: insertError } = await supabase
      .from('invitations')
      .insert({
        organization_id: organizationId,
        invited_by: invitedBy,
        is_new_organization: false,
        email: email.trim() || null,
        base_role: role,
        ...values,
      })
      .select('token')
      .single()

    if (insertError || !data) {
      setError(insertError?.message || 'Could not create the invite. Please try again.')
      setSaving(false)
      return
    }

    setInviteLink(`${window.location.origin}/invite/${data.token}`)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Invite Teammate</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">Close</button>
        </div>

        {inviteLink ? (
          <div>
            <p className="mb-3 text-sm text-muted">
              Invite created — share this link with your teammate:
            </p>
            <div className="flex items-center gap-2">
              <input readOnly value={inviteLink} className={inputCls} />
              <Button size="sm" onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy</Button>
            </div>
            <p className="mt-3 text-xs text-muted">This link expires in 7 days.</p>
            <div className="mt-5">
              <Button variant="ghost" className="w-full" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-muted">Email (optional)</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="jane@example.com" />
              <p className="mt-1 text-xs text-muted">If provided, only this email can use the invite link. The teammate sets their own name when they accept.</p>
            </div>

            <PermissionsEditor
              role={role}
              values={values}
              onChange={next => { setRole(next.role); setValues(next.values) }}
            />

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" onClick={createInvite} disabled={saving}>
                {saving ? 'Creating…' : 'Create Invite'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Commit**

```bash
git add components/InviteTeammateModal.tsx
git commit -m "Add InviteTeammateModal: create in-org invite with role/permission presets"
```

---

### Task 5: Team list page + nav gating

**Files:**
- Create: `app/dashboard/team/page.tsx`
- Create: `components/TeamListClient.tsx`
- Modify: `app/dashboard/layout.tsx`
- Modify: `components/AppShell.tsx`

**Interfaces:**
- Consumes: `components/InviteTeammateModal.tsx`, `lib/supabase/server.ts` (`createClient`), `lib/supabase/client.ts`.
- Produces: route `/dashboard/team` (gated), and a "Team" nav item visible only to `can_manage_users` users. Task 6's edit page is linked from each row (`/dashboard/team/[userId]`).

- [ ] **Step 1: Add the `canManageUsers` prop to `AppShell` and a conditional "Team" nav item**

In `components/AppShell.tsx`, change the component signature and `navItems` handling. Replace the top-level `const navItems = [...]` array and the `export default function AppShell({ children }: ...)` line so the Team item is appended when permitted:

```tsx
const baseNavItems = [
  { href: '/dashboard', label: 'Shows', icon: 'briefcase', match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/shows') },
  { href: '/dashboard/directory', label: 'Directory', icon: 'users', match: (p: string) => p.startsWith('/dashboard/directory') },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings', match: (p: string) => p.startsWith('/dashboard/settings') },
]

const teamNavItem = { href: '/dashboard/team', label: 'Team', icon: 'shield', match: (p: string) => p.startsWith('/dashboard/team') }
```

Change the function signature to accept the prop and build the nav list. Replace `export default function AppShell({ children }: { children: React.ReactNode }) {` and the line `const pathname = usePathname()` with:

```tsx
export default function AppShell({
  children,
  canManageUsers = false,
}: {
  children: React.ReactNode
  canManageUsers?: boolean
}) {
  const pathname = usePathname()
  const navItems = canManageUsers ? [...baseNavItems, teamNavItem] : baseNavItems
```

Then add a `shield` case to the `Icon` function (insert before the final `return` fallback in `Icon`):

```tsx
  if (name === 'shield') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      </svg>
    )
  }
```

(The `navItems.map(...)` calls in both the desktop header and mobile nav already iterate the local `navItems`; no other change needed there.)

- [ ] **Step 2: Pass `canManageUsers` from the layout**

Replace the entire contents of `app/dashboard/layout.tsx`:

```tsx
import AppShell from '@/components/AppShell'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let canManageUsers = false
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('can_manage_users')
      .eq('id', user.id)
      .single()
    canManageUsers = profile?.can_manage_users ?? false
  }

  return <AppShell canManageUsers={canManageUsers}>{children}</AppShell>
}
```

- [ ] **Step 3: Write the Team list client component**

Create `components/TeamListClient.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InviteTeammateModal from '@/components/InviteTeammateModal'

type Member = { id: string; full_name: string | null; email: string | null; base_role: string | null }

export default function TeamListClient({
  organizationId,
  invitedBy,
  members,
}: {
  organizationId: string
  invitedBy: string
  members: Member[]
}) {
  const router = useRouter()
  const [inviting, setInviting] = useState(false)

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">Team</h1>
        <Button size="sm" onClick={() => setInviting(true)}>+ Invite Teammate</Button>
      </div>

      {members.length === 0 ? (
        <p className="text-muted">No team members yet.</p>
      ) : (
        <>
          {/* Desktop: data table */}
          <div className="hidden overflow-hidden rounded-card border border-line bg-surface lg:block">
            <div className="grid grid-cols-[1.6fr_1.8fr_1fr] gap-3 border-b border-line px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-wide text-muted">
              <div>Name</div><div>Email</div><div>Role</div>
            </div>
            {members.map(m => (
              <div
                key={m.id}
                onClick={() => router.push(`/dashboard/team/${m.id}`)}
                className="grid cursor-pointer grid-cols-[1.6fr_1.8fr_1fr] items-center gap-3 border-b border-line px-5 py-3 last:border-b-0 hover:bg-surface-2"
              >
                <div className="truncate font-semibold text-ink">{m.full_name || '—'}</div>
                <div className="truncate text-muted">{m.email || '—'}</div>
                <div className="capitalize text-muted">{m.base_role || '—'}</div>
              </div>
            ))}
          </div>

          {/* Mobile: tappable cards */}
          <div className="divide-y divide-line rounded-card border border-line bg-surface lg:hidden">
            {members.map(m => (
              <button
                key={m.id}
                onClick={() => router.push(`/dashboard/team/${m.id}`)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{m.full_name || m.email || '—'}</p>
                  <p className="text-xs capitalize text-muted">{m.base_role || '—'}</p>
                </div>
                <span className="text-muted">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {inviting && (
        <InviteTeammateModal
          organizationId={organizationId}
          invitedBy={invitedBy}
          onClose={() => { setInviting(false); router.refresh() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write the Team list server page (gated)**

Create `app/dashboard/team/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TeamListClient from '@/components/TeamListClient'

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, can_manage_users')
    .eq('id', user.id)
    .single()

  if (!profile?.can_manage_users || !profile.organization_id) redirect('/dashboard')

  const { data: members } = await supabase
    .from('profiles')
    .select('id, full_name, email, base_role')
    .eq('organization_id', profile.organization_id)
    .order('full_name')

  return (
    <TeamListClient
      organizationId={profile.organization_id}
      invitedBy={user.id}
      members={members || []}
    />
  )
}
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 6: Browser verification (real session)**

Start the preview and drive it (per the preview_tools workflow):
1. `preview_start` with `{name}` for the dev server (create `.claude/launch.json` if needed: `npm run dev`, port 3000).
2. Log in as an admin account (an account whose `can_manage_users` is true).
3. Confirm the "Team" item appears in the top nav (desktop width) — resize to mobile and confirm it appears in the bottom tab-bar too.
4. Navigate to `/dashboard/team`: confirm the member list renders (table on desktop, cards on mobile).
5. Click "Invite Teammate", fill Name/Email, leave role on PM, click "Create Invite": confirm an invite link is shown, and confirm via `npm run db:sql` that a new `invitations` row exists with `is_new_organization = false`, the admin's `organization_id`, and `base_role = 'pm'`:

```bash
printf "select organization_id, is_new_organization, base_role, email from invitations order by created_at desc limit 1;\n" > /tmp/ct-inv-check.sql
npm run db:sql -- /tmp/ct-inv-check.sql
```

6. (Negative gate check) In the browser, navigate directly to `/dashboard/team` while logged in as a NON-admin account (if one is available): confirm you are redirected to `/dashboard` and the "Team" nav item is absent. If no non-admin account is available, note this for the reviewer.

Capture a screenshot of the Team list as proof.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/team/page.tsx components/TeamListClient.tsx app/dashboard/layout.tsx components/AppShell.tsx
git commit -m "Add Team list page + can_manage_users-gated nav item"
```

---

### Task 6: Edit Member page

**Files:**
- Create: `app/dashboard/team/[userId]/page.tsx`
- Create: `components/EditMemberClient.tsx`

**Interfaces:**
- Consumes: `lib/permissions.ts`, `components/PermissionsEditor.tsx`, `lib/supabase/*`. Relies on the Task 1 admin UPDATE policy + trigger being live.
- Produces: route `/dashboard/team/[userId]` (gated) for editing one member's role/permissions.

- [ ] **Step 1: Write the Edit Member client component**

Create `components/EditMemberClient.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import PermissionsEditor from '@/components/PermissionsEditor'
import type { Role, PermissionKey, PermissionValues } from '@/lib/permissions'

export default function EditMemberClient({
  member,
  initialRole,
  initialValues,
  isSelf,
  orgAdminCount,
}: {
  member: { id: string; full_name: string | null; email: string | null }
  initialRole: Role
  initialValues: PermissionValues
  isSelf: boolean
  orgAdminCount: number
}) {
  const router = useRouter()
  const supabase = createClient()
  const [role, setRole] = useState<Role>(initialRole)
  const [values, setValues] = useState<PermissionValues>(initialValues)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // A non-self edit that would remove the org's last admin is blocked client-side.
  const wouldRemoveLastAdmin =
    initialValues.can_manage_users && !values.can_manage_users && orgAdminCount <= 1

  const lockedKeys: PermissionKey[] = isSelf ? ['can_manage_users'] : []

  async function handleSave() {
    setSaving(true)
    setError('')
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ base_role: role, ...values })
      .eq('id', member.id)

    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }
    router.push('/dashboard/team')
    router.refresh()
  }

  return (
    <div className="p-6 md:p-10">
      <button onClick={() => router.push('/dashboard/team')} className="mb-6 text-sm text-muted hover:text-accent">
        ← Back to Team
      </button>

      <h1 className="mb-1 text-2xl font-bold text-ink">{member.full_name || 'Team member'}</h1>
      <p className="mb-6 text-sm text-muted">{member.email || '—'}</p>

      <div className="max-w-lg">
        <PermissionsEditor
          role={role}
          values={values}
          onChange={next => { setRole(next.role); setValues(next.values) }}
          lockedKeys={lockedKeys}
        />

        {isSelf && (
          <p className="mt-3 text-xs text-muted">
            You can&apos;t remove your own “Manage users” permission.
          </p>
        )}
        {wouldRemoveLastAdmin && (
          <p className="mt-3 text-sm text-danger">
            This is the organization&apos;s last admin. Grant another member “Manage users” before removing it here.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => router.push('/dashboard/team')}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving || wouldRemoveLastAdmin}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the Edit Member server page (gated)**

Create `app/dashboard/team/[userId]/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EditMemberClient from '@/components/EditMemberClient'
import { PERMISSION_PRESETS, type Role, type PermissionKey, type PermissionValues } from '@/lib/permissions'

const ALL_KEYS = Object.keys(PERMISSION_PRESETS.admin) as PermissionKey[]

export default async function EditMemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('profiles')
    .select('organization_id, can_manage_users')
    .eq('id', user.id)
    .single()
  if (!me?.can_manage_users || !me.organization_id) redirect('/dashboard')

  // RLS ("Users see profiles in their org") already restricts this to same-org
  // rows; a userId outside the org returns no row.
  const { data: member } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (!member) redirect('/dashboard/team')

  const { count: orgAdminCount } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', me.organization_id)
    .eq('can_manage_users', true)

  // Build the current values object from the member row.
  const initialValues = {} as PermissionValues
  for (const key of ALL_KEYS) initialValues[key] = member[key] ?? false

  const initialRole: Role =
    member.base_role === 'admin' || member.base_role === 'staff' ? member.base_role : 'pm'

  return (
    <EditMemberClient
      member={{ id: member.id, full_name: member.full_name, email: member.email }}
      initialRole={initialRole}
      initialValues={initialValues}
      isSelf={member.id === user.id}
      orgAdminCount={orgAdminCount ?? 1}
    />
  )
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 4: Browser verification (real session — this is the ground-truth test of the DB layer)**

With the dev server running and logged in as an admin:
1. From `/dashboard/team`, click a member (not yourself). Confirm the editor loads with their current role/toggles.
2. Change the role (e.g. PM → Staff), open Advanced, flip one toggle, click "Save Changes". Confirm redirect to `/dashboard/team`, then confirm the change persisted:

```bash
printf "select id, base_role, can_edit_timecards, can_view_reports from profiles order by full_name;\n" > /tmp/ct-prof-check.sql
npm run db:sql -- /tmp/ct-prof-check.sql
```

3. Open your OWN row: confirm the "Manage users" toggle is disabled and the explanatory caption shows.
4. If a second admin exists, demote them and confirm it saves; if only one admin exists, open that admin and confirm attempting to turn off "Manage users" surfaces the last-admin block (Save disabled + red message).
5. (Direct DB-layer confirmation) Re-run the Task 1 behavioral tests to confirm the trigger still guards after all changes:

```bash
npm run db:sql -- scripts/sql/test-team-admin-privileges.sql
```

Expected: `TEST A PASS`, `TEST B PASS`, `TEST C PASS`. Capture a screenshot of the Edit Member screen.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/team/[userId]/page.tsx components/EditMemberClient.tsx
git commit -m "Add Edit Member page: role/permission editor with self + last-admin safeguards"
```

---

## Spec Coverage Check

- Team screen gated to `can_manage_users`, nav + route + server re-check → Tasks 5, 6. ✅
- Invite Teammate into own org (existing `invitations` RLS, `is_new_organization: false`) → Task 4. ✅
- Shared `PermissionsEditor` (role presets + Advanced, used by invite AND edit) → Tasks 3, 4, 6. ✅
- Exact preset table, 14 visible toggles, 4 hidden-but-set, `view_only` hidden → Task 2. ✅
- Edit Member: batched save, error banner, self-lock + last-admin guards (UI) → Task 6. ✅
- Foundational self-escalation fix + admin UPDATE policy + trigger + `can_manage_users_me()` helper → Task 1. ✅
- Service-role/invite-accept trigger safety → Task 1 (Rule early-return on null `auth.uid()`) + noted. ✅
- Shows write bug: drop leftover policy + assignment-aware rewrite → Task 1. ✅
- Roles limited to admin/staff/pm → Task 2 (`ROLES`), Task 6 (role coercion). ✅
- Out of scope (av_roles gating, nested-table write scoping, pending-invite management, remaining inert permissions) → not built; correctly absent. ✅

## Post-completion (Dan-owned, after all tasks + final review)

- The DB migration is already live (single Supabase project — see header note). No separate prod DB step.
- Push to `main` when ready to deploy the UI (Vercel auto-deploys, as with prior work). Then confirm the Team flow once on `crewtracker-lime.vercel.app`.
