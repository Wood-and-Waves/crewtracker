select tablename, policyname, cmd from pg_policies
where tablename in ('profiles', 'organizations', 'av_roles')
order by tablename, cmd;
