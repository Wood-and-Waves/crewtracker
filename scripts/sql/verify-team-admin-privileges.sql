-- Expect: helper function present (1 row).
select proname from pg_proc
where proname = 'can_manage_users_me' and pronamespace = 'public'::regnamespace;

-- Expect: admin update policy present (1 row).
select policyname, cmd from pg_policies
where tablename = 'profiles' and policyname = 'Admins can manage org member permissions';

-- Expect: trigger present (1 row).
select tgname from pg_trigger
where tgrelid = 'profiles'::regclass and tgname = 'enforce_profile_permission_rules';

-- Expect: leftover permissive shows policy GONE (0 rows).
select policyname from pg_policies
where tablename = 'shows' and policyname = 'Users update shows in their org';

-- Expect: exactly ONE shows UPDATE policy, and its condition mentions show_assignments (1 row).
select policyname, qual from pg_policies
where tablename = 'shows' and cmd = 'UPDATE';
