-- Objects that `pg_dump --schema=public` cannot see, captured from production
-- 2026-07-26. Apply after scripts/sql/schema.sql when building a database.
--
-- pg_dump was given --schema=public so a dump would be restorable into another
-- Supabase project. The cost is that anything anchored outside that schema is
-- invisible to it, even when the FUNCTION it calls lives in public and is dumped
-- normally. Both objects below are exactly that shape — a public function that
-- schema.sql restores fine, bound to a trigger that schema.sql never mentions.
-- The failure is silent in both cases: the database restores without error and
-- simply stops enforcing something.
--
-- ============================================================
-- 1. ensure_rls — the automatic-RLS safety net
-- ============================================================
--
-- Production runs an event trigger that force-enables row-level security on
-- every table created in `public`. Combined with Supabase's default privileges
-- (which grant new tables to anon/authenticated), it is what makes a forgotten
-- policy fail CLOSED rather than open — a table with RLS on and no policies is
-- readable by nobody. CLAUDE.md records several features that hit a wall until
-- policies were retrofitted; that wall was this trigger doing its job.
--
-- Event triggers are cluster-level, so `pg_dump --schema=public` never sees
-- them: scripts/sql/schema.sql alone does NOT reproduce this. Applying this file
-- is part of building a database from schema.sql, not an optional extra.
--
-- Supabase exposes the same thing as an "Enable automatic RLS" checkbox at
-- project creation. Keeping it here instead means it is versioned, reviewable,
-- and can't be silently absent because someone missed a checkbox — which is
-- exactly what happened when crewtracker-dev was created.

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

-- The WHEN TAG clause is not decoration: without it the trigger fires on EVERY
-- ddl_command_end, so the function runs (and its loop finds nothing) on every
-- ALTER, CREATE INDEX, CREATE POLICY and so on. Production filters here; match it.
drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

-- ============================================================
-- 2. on_auth_user_created — creates a profile row for a new login
-- ============================================================
-- Without this, signing up produces an auth user with no matching `profiles`
-- row, and the app has no organization, no permissions and no name for them.
-- Discovered missing in crewtracker-dev after a restore that reported no errors.
--
-- CLAUDE.md records that handle_new_user() once shipped without
-- `SET search_path = public` and broke every signup — check that it is still
-- present in the definition below before applying this to anything.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$function$
;

drop trigger if exists on_auth_user_created on auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
