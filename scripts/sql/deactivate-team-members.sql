-- Let an admin remove a teammate from their organization.
--
-- There was no way to do this at all: the Team UI could change a member's role
-- and permissions but never remove them, and `profiles` has no DELETE policy.
-- Someone who left kept their login and their access indefinitely.
--
-- WHY DEACTIVATE RATHER THAN DELETE
-- ---------------------------------
-- A profile row isn't only an identity. shows.created_by, shows.finalized_by and
-- show_assignments all point at it. Deleting the row would either fail on those
-- references or cascade and destroy them — and "who finalized this payroll
-- report" is exactly the record you don't want vanishing when someone leaves.
-- Deactivating keeps the history intact and is reversible when a freelancer
-- comes back next season.
--
-- Deliberately does NOT touch Supabase Auth. The person keeps a login; it simply
-- belongs to no organization, so there is nothing to see. Blocking sign-in is a
-- separate system and a separate decision.
--
-- HOW ACCESS IS ACTUALLY CUT OFF
-- ------------------------------
-- Every org-scoped policy in the schema routes through my_organization_id().
-- Making that return NULL for a deactivated member denies all of them at once —
-- `organization_id = NULL` is never true — so this is enforced in the database,
-- not just hidden in the UI. A removed PM cannot read the crew directory from
-- the REST API afterwards.

begin;

alter table profiles
  add column if not exists deactivated_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. A deactivated member belongs to no organization
-- ---------------------------------------------------------------------------

create or replace function public.my_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from profiles
  where id = auth.uid() and deactivated_at is null;
$$;

create or replace function public.can_see_all_shows()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select can_edit_all_shows from profiles
  where id = auth.uid() and deactivated_at is null;
$$;

-- ---------------------------------------------------------------------------
-- 2. Who may deactivate whom
-- ---------------------------------------------------------------------------
-- A separate trigger rather than another rule inside
-- enforce_profile_permission_rules: that function is long and security-critical,
-- and `create or replace` would mean restating every rule in it — an easy way to
-- drop one by accident (nearly done once already, see the superadmin migration).
--
-- The self-check matters more than it looks. "Users can update their own
-- profile" is scoped only by `id = auth.uid()`, so without this a deactivated
-- member could simply clear their own deactivated_at and walk back in.

create or replace function public.guard_profile_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_ok boolean;
begin
  if new.deactivated_at is not distinct from old.deactivated_at then
    return new;                        -- not a deactivation change
  end if;
  if actor is null then
    return new;                        -- service role / direct SQL
  end if;

  if new.id = actor then
    raise exception 'You cannot deactivate or reactivate your own account.';
  end if;

  select (p.can_manage_users and p.deactivated_at is null)
    into actor_ok
  from profiles p where p.id = actor;

  if not coalesce(actor_ok, false) then
    raise exception 'You do not have permission to remove team members.';
  end if;

  -- Don't let an organization lose its last working admin.
  if new.deactivated_at is not null and coalesce(old.can_manage_users, false) then
    if (select count(*) from profiles
        where organization_id = old.organization_id
          and can_manage_users = true
          and deactivated_at is null
          and id <> old.id) = 0 then
      raise exception 'This is the organization''s last active admin; grant another admin first.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_deactivation on profiles;
create trigger profiles_guard_deactivation
before update on profiles
for each row
execute function public.guard_profile_deactivation();

commit;
