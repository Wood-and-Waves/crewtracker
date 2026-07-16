-- Security audit fixes (2026-07-15): two urgent, contained RLS corrections.
-- Idempotent + transactional: safe to re-run.
begin;

-- 1. CRITICAL: drop the tautological "Anyone can read their own invite
--    token" policy on invitations. `token = token` is always true for
--    every row, applies to the `public` role (including unauthenticated
--    `anon`), and was proven live to expose the entire invitations table
--    -- tokens, emails, and all 18 permission columns -- to anyone with
--    just the public anon key. The one legitimate consumer of invite data
--    (app/invite/[token]/page.tsx) already uses the service-role admin
--    client and never relied on this policy.
drop policy if exists "Anyone can read their own invite token" on invitations;

-- 2. HIGH: fix the show_assignments cross-organization leak.
--    can_see_all_shows() checks only the caller's OWN can_edit_all_shows
--    flag with no organization filter, so any org's admin could read
--    every OTHER organization's show-to-crew assignment rows. Cascade
--    through shows' own (correctly org+visibility scoped) SELECT policy
--    instead of duplicating an unscoped visibility check here.
drop policy if exists "Users see their own assignments" on show_assignments;
create policy "Users see their own assignments"
on show_assignments for select
using (
  show_id in (select id from shows)
);

commit;
