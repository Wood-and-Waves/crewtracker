-- v1 and v2 both still recursed in real (authenticated-role) testing --
-- confirmed empirically that Postgres's RLS recursion guard is structural
-- and per-relation: it fires whenever show_assignments' policy touches
-- `shows` in ANY form (direct, SQL function, PL/pgSQL function, security
-- definer or not) while `shows`' own policy touches show_assignments. The
-- only real fix is to eliminate the circular table reference entirely.
--
-- Denormalize organization_id onto show_assignments (auto-populated via a
-- BEFORE INSERT trigger, which is not part of RLS policy evaluation and
-- does not participate in this guard) so show_assignments' SELECT policy
-- never needs to query `shows` at all. This also restores exactly the
-- original policy's visibility rule (own row, or can_see_all_shows) --
-- just with proper org scoping added, matching what the original design
-- actually needed (it never checked created_by/assignment-visibility
-- beyond "your own row").
-- Idempotent + transactional: safe to re-run.
begin;

alter table show_assignments
  add column if not exists organization_id uuid references organizations(id);

-- Backfill existing rows (run as postgres, which bypasses RLS entirely,
-- so no chicken-and-egg problem reading from shows here).
update show_assignments sa
set organization_id = s.organization_id
from shows s
where s.id = sa.show_id
  and sa.organization_id is null;

-- Auto-populate on insert going forward, so app code never has to
-- remember to set it and it can never drift from the show's own org.
create or replace function public.set_show_assignment_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select organization_id into new.organization_id from shows where id = new.show_id;
  return new;
end;
$$;

drop trigger if exists set_show_assignment_organization_id_trigger on show_assignments;
create trigger set_show_assignment_organization_id_trigger
before insert on show_assignments
for each row
execute function public.set_show_assignment_organization_id();

-- Drop the broken can_see_show() plumbing from v1/v2 -- no longer needed.
drop policy if exists "Users see their own assignments" on show_assignments;
drop function if exists public.can_see_show(uuid);

-- Simple, non-recursive, correctly org-scoped policy: only touches
-- profiles (via the existing my_organization_id()/can_see_all_shows()
-- helpers) and show_assignments' own new organization_id column --
-- never touches shows.
create policy "Users see their own assignments"
on show_assignments for select
using (
  organization_id = my_organization_id()
  and (profile_id = auth.uid() or can_see_all_shows())
);

commit;
