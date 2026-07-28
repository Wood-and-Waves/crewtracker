-- Multi-organization, final step: remove the legacy columns.
--
-- Migrations 0001–0006 moved organization membership and permissions onto
-- `memberships` and left the old `profiles` columns in place as a derived
-- mirror, so screens could be migrated one at a time without a flag day. Every
-- one of them has since moved. This removes the mirror.
--
-- WHY BOTHER, WHEN THEY WERE HARMLESS
-- -----------------------------------
-- They were not harmless. The single real bug in the whole multi-organization
-- change was a POLICY still reading the stale `profiles.organization_id`: the
-- data was correct, the policy silently failed, and the app reported "you belong
-- to no organization" — pointing investigation at exactly the wrong place. A
-- duplicated column that two things can disagree about is a standing invitation
-- to that class of bug, and the only reliable fix is for it not to exist.
--
-- They also misrepresent the model. `profiles.organization_id` is a single
-- column; a person can now be in several organizations. Anything reading it
-- would quietly see one of them and believe it was the answer.
--
-- SAFETY
-- ------
-- Verified before writing this:
--   * no RLS policy references any column dropped below (0006 moved the last two)
--   * my_organization_id() and my_perm() use profiles.active_organization_id,
--     which STAYS — it is the pointer to the active membership
--   * no application code selects them (the superadmin seat count was the last
--     reader and now counts memberships, which is also more correct)
-- This migration must therefore be applied AFTER that app change is deployed.

-- ============================================================
-- 1. Stop maintaining the mirror
-- ============================================================
drop trigger if exists memberships_mirror_profile on public.memberships;
drop function if exists public.sync_profile_from_membership();

-- Guarded columns that are about to stop existing.
drop trigger if exists profiles_guard_derived on public.profiles;
drop function if exists public.guard_profile_derived_columns();

-- ============================================================
-- 2. Remove functions orphaned back in 0004
-- ============================================================
-- These lost their triggers when the guards moved to memberships and have had
-- no caller since — confirmed by checking pg_trigger. Dead code in a security
-- surface is worse than most dead code: it reads like a live rule.
drop function if exists public.enforce_profile_permission_rules();
drop function if exists public.guard_profile_deactivation();
drop function if exists public.sync_membership_from_profile();

-- ============================================================
-- 3. Drop the columns
-- ============================================================
-- Kept deliberately: id, email, full_name, is_super_admin, use_24_hour_time,
-- shoulder_surfer_mode, active_organization_id, created_at, updated_at — the
-- facts that belong to a PERSON rather than to their place in a company.
alter table public.profiles
  drop column if exists organization_id,
  drop column if exists base_role,
  drop column if exists deactivated_at,
  drop column if exists can_manage_users,
  drop column if exists can_manage_billing,
  drop column if exists can_manage_crew_directory,
  drop column if exists can_import_crew,
  drop column if exists can_view_crew_contacts,
  drop column if exists can_create_shows,
  drop column if exists can_edit_all_shows,
  drop column if exists can_archive_shows,
  drop column if exists can_duplicate_shows,
  drop column if exists can_edit_timecards,
  drop column if exists can_approve_timecards,
  drop column if exists can_view_pay_rates,
  drop column if exists can_edit_pay_rates,
  drop column if exists can_manage_rulesets,
  drop column if exists can_view_reports,
  drop column if exists can_export_reports,
  drop column if exists can_send_reports,
  drop column if exists view_only;

-- ============================================================
-- 4. organizations.default_cc_email
-- ============================================================
-- Orphaned. It predated the Final Report, which shipped using
-- `final_report_emails` instead, and was written by the Settings form while
-- being read by nothing — a setting that looked like it did something and did
-- not. The form field was removed some time ago; this removes the column, so
-- the schema stops implying a feature that never existed.
alter table public.organizations drop column if exists default_cc_email;
