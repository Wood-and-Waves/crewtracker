-- Superadmin rework, part 1: turn platform-operator status into data, and give
-- organizations a suspended state.
--
-- WHY
-- ---
-- Superadmin was a UUID hardcoded in two files (app/superadmin/page.tsx and
-- app/api/admin/create-invite/route.ts). Those pages run with the SERVICE ROLE,
-- which bypasses RLS entirely — so that constant was the only thing between a
-- signed-in user and every organization's data. It also meant granting or
-- revoking the role required a code deploy, and nothing else in the app (like a
-- header link) could tell whether the current user had it.
--
-- Both new flags are deliberately NOT settable from the application. The guard
-- trigger below refuses any change to either whenever there is an authenticated
-- user in context, so they can only be changed by direct SQL. That matters most
-- for disabled_at: `org_admins_update_own_org` lets any org admin UPDATE their
-- own organizations row, so without this an admin could simply un-suspend
-- themselves.

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists is_super_admin boolean not null default false;

-- Null = active. A timestamp records when the org was suspended.
alter table organizations
  add column if not exists disabled_at timestamptz;

-- Seed the existing hardcoded operator.
update profiles set is_super_admin = true
where id = '28d3ae69-15bb-42bc-a478-5d9b43b737de';

-- ---------------------------------------------------------------------------
-- 2. is_super_admin cannot be granted from the app
-- ---------------------------------------------------------------------------
-- A SEPARATE trigger, deliberately, rather than adding a line to
-- enforce_profile_permission_rules. That function is ~40 lines of
-- security-critical logic (self-escalation lock, self-demotion guard,
-- last-admin guard) and `create or replace` requires restating all of it —
-- which is an excellent way to silently drop one of those rules. Nothing here
-- needs to interact with them, so this stands alone and can be read on its own.
--
-- Applies to admins too: holding can_manage_users must not let anyone promote
-- themselves, or anyone else, to platform operator.

create or replace function public.guard_profile_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;                       -- service role / direct SQL
  end if;
  if new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'Super admin status cannot be changed from the application.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_super_admin on profiles;
create trigger profiles_guard_super_admin
before update on profiles
for each row
execute function public.guard_profile_super_admin();

-- ---------------------------------------------------------------------------
-- 3. disabled_at cannot be changed from the app
-- ---------------------------------------------------------------------------
-- Without this, org_admins_update_own_org would let a suspended org's admin
-- clear their own suspension.

create or replace function public.guard_organization_disabled_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;                       -- service role / direct SQL
  end if;
  if new.disabled_at is distinct from old.disabled_at then
    raise exception 'Organization status can only be changed by CrewTracker support.';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_guard_disabled_at on organizations;
create trigger organizations_guard_disabled_at
before update on organizations
for each row
execute function public.guard_organization_disabled_at();

commit;
