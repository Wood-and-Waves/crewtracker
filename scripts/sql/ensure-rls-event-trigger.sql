-- The automatic-RLS safety net, captured from production 2026-07-26.
--
-- WHY THIS FILE EXISTS
-- --------------------
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
