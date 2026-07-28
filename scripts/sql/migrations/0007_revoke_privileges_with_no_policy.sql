-- Make an unsupported write fail loudly instead of silently doing nothing.
--
-- THE PROBLEM
-- -----------
-- Several tables grant a privilege to `authenticated` that no RLS policy covers.
-- Postgres denies by default, so the operation is refused — but an UPDATE or
-- DELETE that matches no policy affects **zero rows and returns success**. The
-- app sees no error, reports "saved", and nothing happened.
--
-- This is not hypothetical. CLAUDE.md records exactly this on `work_days`: a day
-- deleted through the app returned success and changed nothing, and the cause
-- took a while to find precisely because there was no error to look at.
--
-- WHY REVOKE RATHER THAN ADD POLICIES
-- -----------------------------------
-- Adding a policy would make these operations *work*, and none of them has a
-- caller: the application never deletes from any table below, and never updates
-- work_days or subscriptions (verified by grep before writing this). Writing
-- policies for features that do not exist means guessing at the rule and
-- shipping unreviewed surface area — the opposite of what CLAUDE.md asks, which
-- is to retrofit a policy when a feature actually needs one.
--
-- Revoking keeps behaviour identical (both refuse) while changing the failure
-- from silent to `42501 permission denied`. Whoever builds "delete a work day"
-- will hit an obvious error naming the table, and add the policy deliberately.
--
-- Several of these absences are deliberate design decisions, not oversights:
--   * shows — archived, never deleted (multi-user product; history matters)
--   * memberships — removal is deactivation, so shows.created_by and
--     finalized_by keep pointing at a real row
--   * show_assignments — a row is either there or it isn't; nothing to update
--   * organizations / profiles / subscriptions — created by SECURITY DEFINER
--     triggers or the service role, which do not use these grants
-- Revoking makes the grant surface match the policy surface, so the schema stops
-- implying capabilities that do not exist.

-- The documented one: no policy, no caller, and the next feature to touch it
-- would have failed silently.
revoke update, delete on table public.work_days from authenticated;

-- Deletes with no policy and no caller.
revoke delete on table public.shows            from authenticated;
revoke delete on table public.memberships      from authenticated;
revoke delete on table public.payroll_rulesets from authenticated;

-- Updates with no policy and no caller.
revoke update on table public.show_assignments from authenticated;

-- Created by triggers or the service role, never by a signed-in user.
revoke insert, delete on table public.organizations from authenticated;
revoke insert, delete on table public.profiles      from authenticated;
revoke insert, delete on table public.subscriptions from authenticated;
