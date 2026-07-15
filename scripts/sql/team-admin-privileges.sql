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
