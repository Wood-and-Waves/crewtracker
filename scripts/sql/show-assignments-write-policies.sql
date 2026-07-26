-- Let admins grant a specific org member access to a specific show.
--
-- Show visibility is `can_see_all_shows() OR assigned via show_assignments OR
-- created_by = me`, and can_see_all_shows() is just the caller's own
-- can_edit_all_shows flag. show_assignments was SELECT-only and empty, and no
-- application code touched it — so every invited non-admin saw an empty app
-- with no way to fix it from inside the product.
--
-- WHY THESE POLICIES NEVER MENTION `shows`
-- ----------------------------------------
-- `shows`' own SELECT policy queries show_assignments. CLAUDE.md records that
-- Postgres's RLS recursion guard is structural and per-relation: it fires
-- however the reference is indirected — plain SQL function, PL/pgSQL, even
-- SECURITY DEFINER. Two earlier attempts failed exactly this way before the
-- organization_id column was denormalized onto this table to break the cycle.
--
-- So the otherwise-natural rule "you may assign people to shows you can see"
-- is not available: evaluating it would have to read `shows`. The gate is a
-- profiles-only permission check instead, which is the right semantics anyway
-- — granting access to a show is an administrative act.
--
-- organization_id is supplied by set_show_assignment_organization_id_trigger
-- (BEFORE INSERT, SECURITY DEFINER), which reads `shows` safely because
-- triggers are not part of RLS policy evaluation. RLS WITH CHECK is evaluated
-- against the final row, after BEFORE triggers have run, so the policy below
-- sees the populated value rather than NULL.
--
-- Idempotent + transactional: safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. One row per (show, member)
-- ---------------------------------------------------------------------------
-- Already guaranteed: the table was created with a UNIQUE constraint
-- `show_assignments_show_id_profile_id_key` on (show_id, profile_id), verified
-- by a real duplicate insert returning 23505. An index added here would be
-- redundant, so this drops the one an earlier revision of this file created.

drop index if exists show_assignments_show_profile_uniq;

-- ---------------------------------------------------------------------------
-- 2. Write policies — same shape as the payroll_presets policies
-- ---------------------------------------------------------------------------

-- The org check alone is NOT sufficient, which real testing caught: because
-- organization_id is derived from the SHOW, an admin could attach a profile
-- belonging to a DIFFERENT organization to their own show and it passed (201).
-- That particular row leaked nothing — the foreign user still fails `shows`'
-- own org check — but it writes a cross-org link that any future query
-- trusting show_assignments would turn into a real leak. The target profile
-- must be in the caller's org too.
--
-- The `profiles` subquery is itself subject to profiles' RLS, so a profile
-- outside the caller's org simply isn't visible and the EXISTS fails. Safe
-- from the recursion guard: profiles' policy does not reference
-- show_assignments (my_organization_id() already reads profiles this way).

drop policy if exists "Admins assign members to shows" on show_assignments;
create policy "Admins assign members to shows"
on show_assignments for insert
with check (
  organization_id = my_organization_id()
  and exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.can_manage_users = true
  )
  and exists (
    select 1 from profiles target
    where target.id = profile_id
      and target.organization_id = my_organization_id()
  )
);

drop policy if exists "Admins revoke member show access" on show_assignments;
create policy "Admins revoke member show access"
on show_assignments for delete
using (
  organization_id = my_organization_id()
  and exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.can_manage_users = true
  )
);

-- Deliberately no UPDATE policy: a row either exists or it doesn't. Changing
-- which show or member a row points at is a delete plus an insert, so it goes
-- through the checks above rather than around them.

commit;
