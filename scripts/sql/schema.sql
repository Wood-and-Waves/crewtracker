--
-- PostgreSQL database dump
--

\restrict YVGKy5PEUuoyQBAtY5gpw3BdQApdQiqnXbaYZuATY7XZCrQuBhEBjrgQqHPTuwO

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "public";


--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: add_show_day("uuid", boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."add_show_day"("p_show_id" "uuid", "p_copy_crew" boolean DEFAULT false) RETURNS TABLE("work_day_id" "uuid", "day_number" integer, "day_date" "date", "rooms_created" integer, "crew_copied" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_last work_days%rowtype;
  v_new  work_days%rowtype;
  v_rooms int := 0;
  v_crew  int := 0;
begin
  select * into v_last
  from work_days
  where show_id = p_show_id
  order by date desc, day_number desc
  limit 1;

  if v_last.id is null then
    raise exception 'This show has no days to extend.';
  end if;

  insert into work_days (show_id, date, day_number)
  values (p_show_id, v_last.date + 1, v_last.day_number + 1)
  returning * into v_new;

  -- Clone the rooms, preserving the source day's display order. Same created_at
  -- convention as scripts/sql/align-room-order.sql so ordering stays consistent
  -- however a day was created.
  insert into rooms (work_day_id, name, created_at)
  select v_new.id,
         r.name,
         v_new.date::timestamptz + (row_number() over (order by r.created_at, r.id)) * interval '1 second'
  from rooms r
  where r.work_day_id = v_last.id;
  get diagnostics v_rooms = row_count;

  if p_copy_crew then
    -- No day_rate: the BEFORE INSERT trigger inherits the show's rate for each
    -- (crew member, role). Matching rooms by name is what makes a roster carry
    -- across to the equivalent room on the new day.
    insert into timecards (room_id, crew_member_id, crew_member_name, role)
    select new_room.id, t.crew_member_id, t.crew_member_name, t.role
    from timecards t
    join rooms old_room on old_room.id = t.room_id
    join rooms new_room on new_room.work_day_id = v_new.id
                       and new_room.name = old_room.name
    where old_room.work_day_id = v_last.id;
    get diagnostics v_crew = row_count;
  end if;

  update shows
  set end_date = greatest(end_date, v_new.date)
  where id = p_show_id;

  return query select v_new.id, v_new.day_number, v_new.date, v_rooms, v_crew;
end;
$$;


--
-- Name: block_writes_when_finalized(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."block_writes_when_finalized"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_room_id uuid;
  v_finalized timestamptz;
begin
  -- Resolve the room, whichever table fired and whichever direction.
  if tg_table_name = 'timecards' then
    if tg_op = 'DELETE' then v_room_id := old.room_id; else v_room_id := new.room_id; end if;
  else -- punches
    select t.room_id into v_room_id
    from timecards t
    where t.id = case when tg_op = 'DELETE' then old.timecard_id else new.timecard_id end;
  end if;

  select s.finalized_at into v_finalized
  from rooms r
  join work_days wd on wd.id = r.work_day_id
  join shows s on s.id = wd.show_id
  where r.id = v_room_id;

  if v_finalized is not null then
    raise exception
      'This show was finalized on % and its times are read-only. An admin can unlock it.',
      to_char(v_finalized, 'YYYY-MM-DD')
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;


--
-- Name: can_manage_users_me(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."can_manage_users_me"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select can_manage_users from profiles where id = auth.uid();
$$;


--
-- Name: can_see_all_shows(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."can_see_all_shows"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select can_edit_all_shows from profiles
  where id = auth.uid() and deactivated_at is null;
$$;


--
-- Name: enforce_pay_rate_write_permission(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."enforce_pay_rate_write_permission"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_may_edit boolean;
begin
  -- System cascade or no user in context: not a user-initiated rate change.
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.day_rate is not distinct from OLD.day_rate then
    return NEW;                       -- rate untouched; nothing to authorise
  end if;

  if TG_OP = 'INSERT' and NEW.day_rate is null then
    return NEW;                       -- no rate supplied
  end if;

  select coalesce(p.can_edit_pay_rates, false) into v_may_edit
  from profiles p where p.id = auth.uid();

  if coalesce(v_may_edit, false) then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    raise exception 'You do not have permission to change pay rates.'
      using errcode = 'check_violation';
  end if;

  -- INSERT: drop the rate rather than refuse the row.
  NEW.day_rate := null;
  return NEW;
end;
$$;


--
-- Name: enforce_profile_permission_rules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."enforce_profile_permission_rules"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


--
-- Name: guard_organization_disabled_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_organization_disabled_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


--
-- Name: guard_profile_deactivation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_profile_deactivation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


--
-- Name: guard_profile_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_profile_super_admin"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


--
-- Name: handle_new_organization(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."handle_new_organization"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO subscriptions (organization_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$;


--
-- Name: inherit_show_day_rate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."inherit_show_day_rate"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_show_id uuid;
  v_rate numeric;
begin
  v_show_id := show_id_for_room(NEW.room_id);
  if v_show_id is null then
    return NEW;
  end if;

  select t.day_rate into v_rate
  from timecards t
  join rooms r on r.id = t.room_id
  join work_days w on w.id = r.work_day_id
  where w.show_id = v_show_id
    and t.role is not distinct from NEW.role
    and t.day_rate is not null
    and (
      case when NEW.crew_member_id is not null
        then t.crew_member_id = NEW.crew_member_id
        else t.crew_member_id is null and t.crew_member_name = NEW.crew_member_name
      end
    )
  order by t.day_rate desc
  limit 1;

  if v_rate is not null then
    NEW.day_rate := v_rate;
  end if;

  return NEW;
end;
$$;


--
-- Name: my_organization_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."my_organization_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select organization_id from profiles
  where id = auth.uid() and deactivated_at is null;
$$;


--
-- Name: propagate_show_day_rate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."propagate_show_day_rate"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_show_id uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  v_show_id := show_id_for_room(NEW.room_id);
  if v_show_id is null then
    return null;
  end if;

  update timecards t
  set day_rate = NEW.day_rate
  from rooms r
  join work_days w on w.id = r.work_day_id
  where r.id = t.room_id
    and w.show_id = v_show_id
    and t.id <> NEW.id
    and t.role is not distinct from NEW.role
    and t.day_rate is distinct from NEW.day_rate
    and (
      case when NEW.crew_member_id is not null
        then t.crew_member_id = NEW.crew_member_id
        else t.crew_member_id is null and t.crew_member_name = NEW.crew_member_name
      end
    );

  return null;
end;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
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
$$;


--
-- Name: set_show_assignment_organization_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_show_assignment_organization_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  select organization_id into new.organization_id from shows where id = new.show_id;
  return new;
end;
$$;


--
-- Name: show_id_for_room("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."show_id_for_room"("p_room_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select w.show_id
  from rooms r
  join work_days w on w.id = r.work_day_id
  where r.id = p_room_id;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: av_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."av_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: crew_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crew_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."profiles" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "full_name" "text",
    "email" "text",
    "base_role" "text" DEFAULT 'crew'::"text" NOT NULL,
    "can_manage_users" boolean DEFAULT false,
    "can_manage_billing" boolean DEFAULT false,
    "can_manage_crew_directory" boolean DEFAULT false,
    "can_import_crew" boolean DEFAULT false,
    "can_view_crew_contacts" boolean DEFAULT false,
    "can_create_shows" boolean DEFAULT false,
    "can_edit_all_shows" boolean DEFAULT false,
    "can_archive_shows" boolean DEFAULT false,
    "can_duplicate_shows" boolean DEFAULT false,
    "can_edit_timecards" boolean DEFAULT false,
    "can_approve_timecards" boolean DEFAULT false,
    "can_view_pay_rates" boolean DEFAULT false,
    "can_edit_pay_rates" boolean DEFAULT false,
    "can_manage_rulesets" boolean DEFAULT false,
    "can_view_reports" boolean DEFAULT false,
    "can_export_reports" boolean DEFAULT false,
    "can_send_reports" boolean DEFAULT false,
    "view_only" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "use_24_hour_time" boolean DEFAULT false NOT NULL,
    "shoulder_surfer_mode" boolean DEFAULT false NOT NULL,
    "is_super_admin" boolean DEFAULT false NOT NULL,
    "deactivated_at" timestamp with time zone,
    CONSTRAINT "profiles_base_role_check" CHECK (("base_role" = ANY (ARRAY['admin'::"text", 'staff'::"text", 'pm'::"text", 'crew'::"text"])))
);


--
-- Name: rate_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."rate_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "crew_member_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "day_rate" numeric DEFAULT 0.0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: crew_rate_cards_visible; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."crew_rate_cards_visible" WITH ("security_invoker"='false') AS
 SELECT "rc"."id",
    "rc"."crew_member_id",
    "rc"."role",
    "rc"."day_rate"
   FROM ("public"."rate_cards" "rc"
     JOIN "public"."crew_members" "cm" ON (("cm"."id" = "rc"."crew_member_id")))
  WHERE (("cm"."organization_id" = "public"."my_organization_id"()) AND COALESCE(( SELECT "p"."can_view_pay_rates"
           FROM "public"."profiles" "p"
          WHERE ("p"."id" = "auth"."uid"())), false));


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "invited_by" "uuid",
    "email" "text",
    "base_role" "text" DEFAULT 'pm'::"text",
    "can_manage_users" boolean DEFAULT false,
    "can_manage_billing" boolean DEFAULT false,
    "can_manage_crew_directory" boolean DEFAULT false,
    "can_import_crew" boolean DEFAULT false,
    "can_view_crew_contacts" boolean DEFAULT false,
    "can_create_shows" boolean DEFAULT false,
    "can_edit_all_shows" boolean DEFAULT false,
    "can_archive_shows" boolean DEFAULT false,
    "can_duplicate_shows" boolean DEFAULT false,
    "can_edit_timecards" boolean DEFAULT false,
    "can_approve_timecards" boolean DEFAULT false,
    "can_view_pay_rates" boolean DEFAULT false,
    "can_edit_pay_rates" boolean DEFAULT false,
    "can_manage_rulesets" boolean DEFAULT false,
    "can_view_reports" boolean DEFAULT false,
    "can_export_reports" boolean DEFAULT false,
    "can_send_reports" boolean DEFAULT false,
    "view_only" boolean DEFAULT false,
    "is_new_organization" boolean DEFAULT false,
    "organization_name" "text",
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "invitations_base_role_check" CHECK (("base_role" = ANY (ARRAY['admin'::"text", 'staff'::"text", 'pm'::"text", 'crew'::"text"])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "timecard_rounding_minutes" integer DEFAULT 1 NOT NULL,
    "default_cc_email" "text",
    "final_report_emails" "text",
    "disabled_at" timestamp with time zone
);


--
-- Name: COLUMN "organizations"."final_report_emails"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."organizations"."final_report_emails" IS 'Comma-separated recipients for the end-of-show Final Report email. Admin-managed; never supplied by the client.';


--
-- Name: payroll_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."payroll_presets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "overtime_after_hours" numeric DEFAULT 10.0 NOT NULL,
    "double_time_enabled" boolean DEFAULT false NOT NULL,
    "double_time_after_hours" numeric DEFAULT 12.0 NOT NULL,
    "travel_rate" "text" DEFAULT 'halfDay'::"text" NOT NULL,
    "meal_penalty_enabled" boolean DEFAULT false NOT NULL,
    "meal_penalty_grace_period" numeric DEFAULT 6.0 NOT NULL,
    "meal_penalty_amount" numeric DEFAULT 0.0 NOT NULL,
    "continuous_time_enabled" boolean DEFAULT false NOT NULL,
    "minimum_meal_break_enabled" boolean DEFAULT true NOT NULL,
    "minimum_meal_break_minutes" numeric DEFAULT 60.0 NOT NULL,
    "meal_break_deduction_cap" numeric DEFAULT 60.0 NOT NULL,
    "short_turn_penalty_enabled" boolean DEFAULT false NOT NULL,
    "short_turn_rest_hours" numeric DEFAULT 10.0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: payroll_rulesets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."payroll_rulesets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "show_id" "uuid" NOT NULL,
    "overtime_after_hours" numeric DEFAULT 10.0,
    "double_time_enabled" boolean DEFAULT false,
    "double_time_after_hours" numeric DEFAULT 12.0,
    "travel_rate" "text" DEFAULT 'halfDay'::"text",
    "meal_penalty_enabled" boolean DEFAULT false,
    "meal_penalty_grace_period" numeric DEFAULT 6.0,
    "meal_penalty_amount" numeric DEFAULT 0.0,
    "minimum_meal_break_enabled" boolean DEFAULT true,
    "minimum_meal_break_minutes" numeric DEFAULT 60.0,
    "meal_break_deduction_cap" numeric DEFAULT 60.0,
    "short_turn_penalty_enabled" boolean DEFAULT false,
    "short_turn_rest_hours" numeric DEFAULT 10.0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "continuous_time_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "payroll_rulesets_travel_rate_check" CHECK (("travel_rate" = ANY (ARRAY['halfDay'::"text", 'fullDay'::"text"])))
);


--
-- Name: punches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."punches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "timecard_id" "uuid" NOT NULL,
    "punch_type" "text" NOT NULL,
    "punched_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "punches_punch_type_check" CHECK (("punch_type" = ANY (ARRAY['start'::"text", 'meal_out'::"text", 'meal_in'::"text", 'meal2_out'::"text", 'meal2_in'::"text", 'meal3_out'::"text", 'meal3_in'::"text", 'end'::"text"])))
);


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_day_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."schema_migrations" (
    "filename" "text" NOT NULL,
    "checksum" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: show_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."show_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "show_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "organization_id" "uuid"
);


--
-- Name: shows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "venue" "text",
    "start_date" "date",
    "end_date" "date",
    "timezone_identifier" "text" DEFAULT 'America/Chicago'::"text",
    "archived" boolean DEFAULT false,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "client_company" "text",
    "job_number" "text",
    "show_notes" "text",
    "show_financials" boolean DEFAULT false,
    "city_state" "text",
    "finalized_at" timestamp with time zone,
    "finalized_by" "uuid",
    "final_report_recipients" "text"
);


--
-- Name: COLUMN "shows"."finalized_at"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."shows"."finalized_at" IS 'Set when the Final Report is sent. Non-null means times are locked.';


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'trial'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "trial_ends_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval),
    "current_period_ends_at" timestamp with time zone,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "max_users" integer DEFAULT 5,
    "max_shows" integer DEFAULT 10,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['trial'::"text", 'starter'::"text", 'pro'::"text", 'enterprise'::"text"]))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'cancelled'::"text", 'trialing'::"text"])))
);


--
-- Name: timecards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."timecards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "crew_member_id" "uuid",
    "crew_member_name" "text" NOT NULL,
    "role" "text",
    "day_rate" numeric DEFAULT 0.0,
    "is_travel_day" boolean DEFAULT false,
    "travel_in_day" boolean DEFAULT false,
    "travel_out_day" boolean DEFAULT false,
    "pay_as_half_day" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: work_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."work_days" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "show_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "day_number" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: timecard_day_rates; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."timecard_day_rates" WITH ("security_invoker"='false') AS
 SELECT "t"."id" AS "timecard_id",
    "w"."show_id",
    "t"."day_rate"
   FROM ((("public"."timecards" "t"
     JOIN "public"."rooms" "r" ON (("r"."id" = "t"."room_id")))
     JOIN "public"."work_days" "w" ON (("w"."id" = "r"."work_day_id")))
     JOIN "public"."shows" "s" ON (("s"."id" = "w"."show_id")))
  WHERE (("s"."organization_id" = "public"."my_organization_id"()) AND COALESCE(( SELECT "p"."can_view_pay_rates"
           FROM "public"."profiles" "p"
          WHERE ("p"."id" = "auth"."uid"())), false) AND ("public"."can_see_all_shows"() OR ("s"."created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."show_assignments" "sa"
          WHERE (("sa"."show_id" = "s"."id") AND ("sa"."profile_id" = "auth"."uid"()))))));


--
-- Name: av_roles av_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."av_roles"
    ADD CONSTRAINT "av_roles_pkey" PRIMARY KEY ("id");


--
-- Name: crew_members crew_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crew_members"
    ADD CONSTRAINT "crew_members_pkey" PRIMARY KEY ("id");


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");


--
-- Name: payroll_presets payroll_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payroll_presets"
    ADD CONSTRAINT "payroll_presets_pkey" PRIMARY KEY ("id");


--
-- Name: payroll_rulesets payroll_rulesets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payroll_rulesets"
    ADD CONSTRAINT "payroll_rulesets_pkey" PRIMARY KEY ("id");


--
-- Name: payroll_rulesets payroll_rulesets_show_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payroll_rulesets"
    ADD CONSTRAINT "payroll_rulesets_show_id_key" UNIQUE ("show_id");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


--
-- Name: punches punches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."punches"
    ADD CONSTRAINT "punches_pkey" PRIMARY KEY ("id");


--
-- Name: rate_cards rate_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."rate_cards"
    ADD CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id");


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_pkey" PRIMARY KEY ("id");


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("filename");


--
-- Name: show_assignments show_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."show_assignments"
    ADD CONSTRAINT "show_assignments_pkey" PRIMARY KEY ("id");


--
-- Name: show_assignments show_assignments_show_id_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."show_assignments"
    ADD CONSTRAINT "show_assignments_show_id_profile_id_key" UNIQUE ("show_id", "profile_id");


--
-- Name: shows shows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shows"
    ADD CONSTRAINT "shows_pkey" PRIMARY KEY ("id");


--
-- Name: subscriptions subscriptions_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_organization_id_key" UNIQUE ("organization_id");


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");


--
-- Name: timecards timecards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."timecards"
    ADD CONSTRAINT "timecards_pkey" PRIMARY KEY ("id");


--
-- Name: work_days work_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."work_days"
    ADD CONSTRAINT "work_days_pkey" PRIMARY KEY ("id");


--
-- Name: work_days work_days_show_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."work_days"
    ADD CONSTRAINT "work_days_show_id_date_key" UNIQUE ("show_id", "date");


--
-- Name: payroll_presets_one_default_per_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "payroll_presets_one_default_per_org" ON "public"."payroll_presets" USING "btree" ("organization_id") WHERE "is_default";


--
-- Name: payroll_presets_org_name_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "payroll_presets_org_name_uniq" ON "public"."payroll_presets" USING "btree" ("organization_id", "lower"("name"));


--
-- Name: timecards_room_crew_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "timecards_room_crew_uniq" ON "public"."timecards" USING "btree" ("room_id", "crew_member_id") WHERE ("crew_member_id" IS NOT NULL);


--
-- Name: profiles enforce_profile_permission_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "enforce_profile_permission_rules" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_profile_permission_rules"();


--
-- Name: organizations on_organization_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "on_organization_created" AFTER INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_organization"();


--
-- Name: organizations organizations_guard_disabled_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organizations_guard_disabled_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."guard_organization_disabled_at"();


--
-- Name: profiles profiles_guard_deactivation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "profiles_guard_deactivation" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."guard_profile_deactivation"();


--
-- Name: profiles profiles_guard_super_admin; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "profiles_guard_super_admin" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."guard_profile_super_admin"();


--
-- Name: punches punches_blocked_when_finalized; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "punches_blocked_when_finalized" BEFORE INSERT OR DELETE OR UPDATE ON "public"."punches" FOR EACH ROW EXECUTE FUNCTION "public"."block_writes_when_finalized"();


--
-- Name: rate_cards rate_cards_check_pay_rate_permission; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "rate_cards_check_pay_rate_permission" BEFORE INSERT OR UPDATE ON "public"."rate_cards" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_pay_rate_write_permission"();


--
-- Name: show_assignments set_show_assignment_organization_id_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "set_show_assignment_organization_id_trigger" BEFORE INSERT ON "public"."show_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_show_assignment_organization_id"();


--
-- Name: timecards timecards_blocked_when_finalized; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "timecards_blocked_when_finalized" BEFORE INSERT OR DELETE OR UPDATE ON "public"."timecards" FOR EACH ROW EXECUTE FUNCTION "public"."block_writes_when_finalized"();


--
-- Name: timecards timecards_check_pay_rate_permission; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "timecards_check_pay_rate_permission" BEFORE INSERT OR UPDATE ON "public"."timecards" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_pay_rate_write_permission"();


--
-- Name: timecards timecards_inherit_show_day_rate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "timecards_inherit_show_day_rate" BEFORE INSERT ON "public"."timecards" FOR EACH ROW EXECUTE FUNCTION "public"."inherit_show_day_rate"();


--
-- Name: timecards timecards_propagate_show_day_rate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "timecards_propagate_show_day_rate" AFTER UPDATE OF "day_rate" ON "public"."timecards" FOR EACH ROW WHEN (("old"."day_rate" IS DISTINCT FROM "new"."day_rate")) EXECUTE FUNCTION "public"."propagate_show_day_rate"();


--
-- Name: av_roles av_roles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."av_roles"
    ADD CONSTRAINT "av_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");


--
-- Name: crew_members crew_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crew_members"
    ADD CONSTRAINT "crew_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id");


--
-- Name: invitations invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: payroll_presets payroll_presets_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payroll_presets"
    ADD CONSTRAINT "payroll_presets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: payroll_rulesets payroll_rulesets_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payroll_rulesets"
    ADD CONSTRAINT "payroll_rulesets_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: profiles profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: punches punches_timecard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."punches"
    ADD CONSTRAINT "punches_timecard_id_fkey" FOREIGN KEY ("timecard_id") REFERENCES "public"."timecards"("id") ON DELETE CASCADE;


--
-- Name: rate_cards rate_cards_crew_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."rate_cards"
    ADD CONSTRAINT "rate_cards_crew_member_id_fkey" FOREIGN KEY ("crew_member_id") REFERENCES "public"."crew_members"("id") ON DELETE CASCADE;


--
-- Name: rooms rooms_work_day_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_work_day_id_fkey" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE CASCADE;


--
-- Name: show_assignments show_assignments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."show_assignments"
    ADD CONSTRAINT "show_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");


--
-- Name: show_assignments show_assignments_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."show_assignments"
    ADD CONSTRAINT "show_assignments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: show_assignments show_assignments_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."show_assignments"
    ADD CONSTRAINT "show_assignments_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE CASCADE;


--
-- Name: shows shows_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shows"
    ADD CONSTRAINT "shows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: shows shows_finalized_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shows"
    ADD CONSTRAINT "shows_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "public"."profiles"("id");


--
-- Name: shows shows_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shows"
    ADD CONSTRAINT "shows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: timecards timecards_crew_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."timecards"
    ADD CONSTRAINT "timecards_crew_member_id_fkey" FOREIGN KEY ("crew_member_id") REFERENCES "public"."crew_members"("id");


--
-- Name: timecards timecards_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."timecards"
    ADD CONSTRAINT "timecards_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE;


--
-- Name: work_days work_days_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."work_days"
    ADD CONSTRAINT "work_days_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE CASCADE;


--
-- Name: show_assignments Admins assign members to shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins assign members to shows" ON "public"."show_assignments" FOR INSERT WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."can_manage_users" = true)))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "target"
  WHERE (("target"."id" = "show_assignments"."profile_id") AND ("target"."organization_id" = "public"."my_organization_id"()))))));


--
-- Name: invitations Admins can manage invitations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage invitations" ON "public"."invitations" USING ((("organization_id" = "public"."my_organization_id"()) AND ( SELECT "profiles"."can_manage_users"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));


--
-- Name: profiles Admins can manage org member permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage org member permissions" ON "public"."profiles" FOR UPDATE USING ((("organization_id" = "public"."my_organization_id"()) AND "public"."can_manage_users_me"())) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND "public"."can_manage_users_me"()));


--
-- Name: show_assignments Admins revoke member show access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins revoke member show access" ON "public"."show_assignments" FOR DELETE USING ((("organization_id" = "public"."my_organization_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."can_manage_users" = true))))));


--
-- Name: subscriptions Only admins can update subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can update subscription" ON "public"."subscriptions" FOR UPDATE USING ((("organization_id" = "public"."my_organization_id"()) AND ( SELECT "profiles"."can_manage_billing"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));


--
-- Name: subscriptions Org members can see their subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can see their subscription" ON "public"."subscriptions" FOR SELECT USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: shows Users can create shows if permitted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create shows if permitted" ON "public"."shows" FOR INSERT WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ( SELECT "profiles"."can_create_shows"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));


--
-- Name: crew_members Users can manage crew if permitted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage crew if permitted" ON "public"."crew_members" USING ((("organization_id" = "public"."my_organization_id"()) AND ( SELECT "profiles"."can_manage_crew_directory"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));


--
-- Name: shows Users can update shows they can see; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update shows they can see" ON "public"."shows" FOR UPDATE USING ((("organization_id" = "public"."my_organization_id"()) AND ( SELECT "profiles"."can_edit_timecards"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) AND ("public"."can_see_all_shows"() OR ("id" IN ( SELECT "show_assignments"."show_id"
   FROM "public"."show_assignments"
  WHERE ("show_assignments"."profile_id" = "auth"."uid"()))) OR ("created_by" = "auth"."uid"())))) WITH CHECK (("organization_id" = "public"."my_organization_id"()));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));


--
-- Name: punches Users create punches for their org timecards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create punches for their org timecards" ON "public"."punches" FOR INSERT WITH CHECK (("timecard_id" IN ( SELECT "t"."id"
   FROM ((("public"."timecards" "t"
     JOIN "public"."rooms" "r" ON (("r"."id" = "t"."room_id")))
     JOIN "public"."work_days" "wd" ON (("wd"."id" = "r"."work_day_id")))
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: rate_cards Users create rate cards for their org crew; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create rate cards for their org crew" ON "public"."rate_cards" FOR INSERT WITH CHECK (("crew_member_id" IN ( SELECT "crew_members"."id"
   FROM "public"."crew_members"
  WHERE ("crew_members"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: rooms Users create rooms for their org shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create rooms for their org shows" ON "public"."rooms" FOR INSERT WITH CHECK (("work_day_id" IN ( SELECT "wd"."id"
   FROM ("public"."work_days" "wd"
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: payroll_rulesets Users create rulesets for their org shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create rulesets for their org shows" ON "public"."payroll_rulesets" FOR INSERT WITH CHECK (("show_id" IN ( SELECT "shows"."id"
   FROM "public"."shows"
  WHERE ("shows"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: timecards Users create timecards for their org shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create timecards for their org shows" ON "public"."timecards" FOR INSERT WITH CHECK (("room_id" IN ( SELECT "r"."id"
   FROM (("public"."rooms" "r"
     JOIN "public"."work_days" "wd" ON (("wd"."id" = "r"."work_day_id")))
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: work_days Users create work days for their org shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create work days for their org shows" ON "public"."work_days" FOR INSERT WITH CHECK (("show_id" IN ( SELECT "shows"."id"
   FROM "public"."shows"
  WHERE ("shows"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: punches Users delete punches for their org timecards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete punches for their org timecards" ON "public"."punches" FOR DELETE USING (("timecard_id" IN ( SELECT "t"."id"
   FROM ((("public"."timecards" "t"
     JOIN "public"."rooms" "r" ON (("r"."id" = "t"."room_id")))
     JOIN "public"."work_days" "wd" ON (("wd"."id" = "r"."work_day_id")))
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: rate_cards Users delete rate cards for their org crew; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete rate cards for their org crew" ON "public"."rate_cards" FOR DELETE USING (("crew_member_id" IN ( SELECT "crew_members"."id"
   FROM "public"."crew_members"
  WHERE ("crew_members"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: timecards Users delete timecards for their org shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete timecards for their org shows" ON "public"."timecards" FOR DELETE USING (("room_id" IN ( SELECT "r"."id"
   FROM (("public"."rooms" "r"
     JOIN "public"."work_days" "wd" ON (("wd"."id" = "r"."work_day_id")))
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: av_roles Users manage roles in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage roles in their org" ON "public"."av_roles" USING (("organization_id" = "public"."my_organization_id"())) WITH CHECK (("organization_id" = "public"."my_organization_id"()));


--
-- Name: crew_members Users see crew in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see crew in their org" ON "public"."crew_members" FOR SELECT USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: profiles Users see profiles in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see profiles in their org" ON "public"."profiles" FOR SELECT USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: punches Users see punches for their timecards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see punches for their timecards" ON "public"."punches" FOR SELECT USING (("timecard_id" IN ( SELECT "timecards"."id"
   FROM "public"."timecards")));


--
-- Name: rate_cards Users see rate cards for their org crew; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see rate cards for their org crew" ON "public"."rate_cards" FOR SELECT USING (("crew_member_id" IN ( SELECT "crew_members"."id"
   FROM "public"."crew_members")));


--
-- Name: av_roles Users see roles in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see roles in their org" ON "public"."av_roles" FOR SELECT USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: rooms Users see rooms for their shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see rooms for their shows" ON "public"."rooms" FOR SELECT USING (("work_day_id" IN ( SELECT "work_days"."id"
   FROM "public"."work_days")));


--
-- Name: payroll_rulesets Users see rulesets for their shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see rulesets for their shows" ON "public"."payroll_rulesets" FOR SELECT USING (("show_id" IN ( SELECT "shows"."id"
   FROM "public"."shows")));


--
-- Name: shows Users see their org shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see their org shows" ON "public"."shows" FOR SELECT USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."can_see_all_shows"() OR ("id" IN ( SELECT "show_assignments"."show_id"
   FROM "public"."show_assignments"
  WHERE ("show_assignments"."profile_id" = "auth"."uid"()))) OR ("created_by" = "auth"."uid"()))));


--
-- Name: show_assignments Users see their own assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see their own assignments" ON "public"."show_assignments" FOR SELECT USING ((("organization_id" = "public"."my_organization_id"()) AND (("profile_id" = "auth"."uid"()) OR "public"."can_see_all_shows"())));


--
-- Name: organizations Users see their own organization; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see their own organization" ON "public"."organizations" FOR SELECT USING (("id" = "public"."my_organization_id"()));


--
-- Name: timecards Users see timecards for their shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see timecards for their shows" ON "public"."timecards" FOR SELECT USING (("room_id" IN ( SELECT "rooms"."id"
   FROM "public"."rooms")));


--
-- Name: work_days Users see work days for their shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see work days for their shows" ON "public"."work_days" FOR SELECT USING (("show_id" IN ( SELECT "shows"."id"
   FROM "public"."shows")));


--
-- Name: punches Users update punches for their org timecards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update punches for their org timecards" ON "public"."punches" FOR UPDATE USING (("timecard_id" IN ( SELECT "t"."id"
   FROM ((("public"."timecards" "t"
     JOIN "public"."rooms" "r" ON (("r"."id" = "t"."room_id")))
     JOIN "public"."work_days" "wd" ON (("wd"."id" = "r"."work_day_id")))
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: rate_cards Users update rate cards for their org crew; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update rate cards for their org crew" ON "public"."rate_cards" FOR UPDATE USING (("crew_member_id" IN ( SELECT "crew_members"."id"
   FROM "public"."crew_members"
  WHERE ("crew_members"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: payroll_rulesets Users update rulesets for their org shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update rulesets for their org shows" ON "public"."payroll_rulesets" FOR UPDATE USING (("show_id" IN ( SELECT "shows"."id"
   FROM "public"."shows"
  WHERE ("shows"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: timecards Users update timecards for their org shows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update timecards for their org shows" ON "public"."timecards" FOR UPDATE USING (("room_id" IN ( SELECT "r"."id"
   FROM (("public"."rooms" "r"
     JOIN "public"."work_days" "wd" ON (("wd"."id" = "r"."work_day_id")))
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: av_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."av_roles" ENABLE ROW LEVEL SECURITY;

--
-- Name: crew_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."crew_members" ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations org_admins_update_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org_admins_update_own_org" ON "public"."organizations" FOR UPDATE USING ((("id" = "public"."my_organization_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."can_manage_users" = true)))))) WITH CHECK ((("id" = "public"."my_organization_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."can_manage_users" = true))))));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_presets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."payroll_presets" ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_rulesets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."payroll_rulesets" ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_presets presets_delete_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "presets_delete_own_org" ON "public"."payroll_presets" FOR DELETE USING ((("organization_id" = "public"."my_organization_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."can_manage_rulesets" = true))))));


--
-- Name: payroll_presets presets_insert_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "presets_insert_own_org" ON "public"."payroll_presets" FOR INSERT WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."can_manage_rulesets" = true))))));


--
-- Name: payroll_presets presets_select_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "presets_select_own_org" ON "public"."payroll_presets" FOR SELECT USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: payroll_presets presets_update_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "presets_update_own_org" ON "public"."payroll_presets" FOR UPDATE USING ((("organization_id" = "public"."my_organization_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."can_manage_rulesets" = true)))))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."can_manage_rulesets" = true))))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: punches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."punches" ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."rate_cards" ENABLE ROW LEVEL SECURITY;

--
-- Name: rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;

--
-- Name: rooms rooms_delete_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rooms_delete_own_org" ON "public"."rooms" FOR DELETE USING (("work_day_id" IN ( SELECT "wd"."id"
   FROM ("public"."work_days" "wd"
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: rooms rooms_update_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rooms_update_own_org" ON "public"."rooms" FOR UPDATE USING (("work_day_id" IN ( SELECT "wd"."id"
   FROM ("public"."work_days" "wd"
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"())))) WITH CHECK (("work_day_id" IN ( SELECT "wd"."id"
   FROM ("public"."work_days" "wd"
     JOIN "public"."shows" "s" ON (("s"."id" = "wd"."show_id")))
  WHERE ("s"."organization_id" = "public"."my_organization_id"()))));


--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."schema_migrations" ENABLE ROW LEVEL SECURITY;

--
-- Name: show_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."show_assignments" ENABLE ROW LEVEL SECURITY;

--
-- Name: shows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."shows" ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;

--
-- Name: timecards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."timecards" ENABLE ROW LEVEL SECURITY;

--
-- Name: work_days; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."work_days" ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "add_show_day"("p_show_id" "uuid", "p_copy_crew" boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."add_show_day"("p_show_id" "uuid", "p_copy_crew" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_show_day"("p_show_id" "uuid", "p_copy_crew" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_show_day"("p_show_id" "uuid", "p_copy_crew" boolean) TO "service_role";


--
-- Name: FUNCTION "block_writes_when_finalized"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."block_writes_when_finalized"() TO "anon";
GRANT ALL ON FUNCTION "public"."block_writes_when_finalized"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."block_writes_when_finalized"() TO "service_role";


--
-- Name: FUNCTION "can_manage_users_me"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."can_manage_users_me"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_users_me"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_users_me"() TO "service_role";


--
-- Name: FUNCTION "can_see_all_shows"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."can_see_all_shows"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_see_all_shows"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_see_all_shows"() TO "service_role";


--
-- Name: FUNCTION "enforce_pay_rate_write_permission"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."enforce_pay_rate_write_permission"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_pay_rate_write_permission"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_pay_rate_write_permission"() TO "service_role";


--
-- Name: FUNCTION "enforce_profile_permission_rules"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."enforce_profile_permission_rules"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_profile_permission_rules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_profile_permission_rules"() TO "service_role";


--
-- Name: FUNCTION "guard_organization_disabled_at"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."guard_organization_disabled_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_organization_disabled_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_organization_disabled_at"() TO "service_role";


--
-- Name: FUNCTION "guard_profile_deactivation"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."guard_profile_deactivation"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_profile_deactivation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_profile_deactivation"() TO "service_role";


--
-- Name: FUNCTION "guard_profile_super_admin"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."guard_profile_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_profile_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_profile_super_admin"() TO "service_role";


--
-- Name: FUNCTION "handle_new_organization"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."handle_new_organization"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_organization"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_organization"() TO "service_role";


--
-- Name: FUNCTION "handle_new_user"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


--
-- Name: FUNCTION "inherit_show_day_rate"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."inherit_show_day_rate"() TO "anon";
GRANT ALL ON FUNCTION "public"."inherit_show_day_rate"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."inherit_show_day_rate"() TO "service_role";


--
-- Name: FUNCTION "my_organization_id"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "service_role";


--
-- Name: FUNCTION "propagate_show_day_rate"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."propagate_show_day_rate"() TO "anon";
GRANT ALL ON FUNCTION "public"."propagate_show_day_rate"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."propagate_show_day_rate"() TO "service_role";


--
-- Name: FUNCTION "rls_auto_enable"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


--
-- Name: FUNCTION "set_show_assignment_organization_id"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."set_show_assignment_organization_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_show_assignment_organization_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_show_assignment_organization_id"() TO "service_role";


--
-- Name: FUNCTION "show_id_for_room"("p_room_id" "uuid"); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."show_id_for_room"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."show_id_for_room"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_id_for_room"("p_room_id" "uuid") TO "service_role";


--
-- Name: TABLE "av_roles"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."av_roles" TO "anon";
GRANT ALL ON TABLE "public"."av_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."av_roles" TO "service_role";


--
-- Name: TABLE "crew_members"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."crew_members" TO "anon";
GRANT ALL ON TABLE "public"."crew_members" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_members" TO "service_role";


--
-- Name: TABLE "profiles"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


--
-- Name: TABLE "rate_cards"; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."rate_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_cards" TO "service_role";


--
-- Name: COLUMN "rate_cards"."id"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("id") ON TABLE "public"."rate_cards" TO "authenticated";


--
-- Name: COLUMN "rate_cards"."crew_member_id"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("crew_member_id") ON TABLE "public"."rate_cards" TO "authenticated";


--
-- Name: COLUMN "rate_cards"."role"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("role") ON TABLE "public"."rate_cards" TO "authenticated";


--
-- Name: COLUMN "rate_cards"."created_at"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("created_at") ON TABLE "public"."rate_cards" TO "authenticated";


--
-- Name: TABLE "crew_rate_cards_visible"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."crew_rate_cards_visible" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_rate_cards_visible" TO "service_role";


--
-- Name: TABLE "invitations"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";


--
-- Name: TABLE "organizations"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";


--
-- Name: TABLE "payroll_presets"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."payroll_presets" TO "anon";
GRANT ALL ON TABLE "public"."payroll_presets" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_presets" TO "service_role";


--
-- Name: TABLE "payroll_rulesets"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."payroll_rulesets" TO "anon";
GRANT ALL ON TABLE "public"."payroll_rulesets" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_rulesets" TO "service_role";


--
-- Name: TABLE "punches"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."punches" TO "anon";
GRANT ALL ON TABLE "public"."punches" TO "authenticated";
GRANT ALL ON TABLE "public"."punches" TO "service_role";


--
-- Name: TABLE "rooms"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."rooms" TO "anon";
GRANT ALL ON TABLE "public"."rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."rooms" TO "service_role";


--
-- Name: TABLE "schema_migrations"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."schema_migrations" TO "service_role";


--
-- Name: TABLE "show_assignments"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."show_assignments" TO "anon";
GRANT ALL ON TABLE "public"."show_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."show_assignments" TO "service_role";


--
-- Name: TABLE "shows"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."shows" TO "anon";
GRANT ALL ON TABLE "public"."shows" TO "authenticated";
GRANT ALL ON TABLE "public"."shows" TO "service_role";


--
-- Name: TABLE "subscriptions"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";


--
-- Name: TABLE "timecards"; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."timecards" TO "authenticated";
GRANT ALL ON TABLE "public"."timecards" TO "service_role";


--
-- Name: COLUMN "timecards"."id"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("id") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."room_id"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("room_id") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."crew_member_id"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("crew_member_id") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."crew_member_name"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("crew_member_name") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."role"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("role") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."is_travel_day"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("is_travel_day") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."travel_in_day"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("travel_in_day") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."travel_out_day"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("travel_out_day") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."pay_as_half_day"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("pay_as_half_day") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."created_at"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("created_at") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: COLUMN "timecards"."updated_at"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("updated_at") ON TABLE "public"."timecards" TO "authenticated";


--
-- Name: TABLE "work_days"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."work_days" TO "anon";
GRANT ALL ON TABLE "public"."work_days" TO "authenticated";
GRANT ALL ON TABLE "public"."work_days" TO "service_role";


--
-- Name: TABLE "timecard_day_rates"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."timecard_day_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."timecard_day_rates" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- PostgreSQL database dump complete
--

\unrestrict YVGKy5PEUuoyQBAtY5gpw3BdQApdQiqnXbaYZuATY7XZCrQuBhEBjrgQqHPTuwO

