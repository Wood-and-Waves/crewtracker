select policyname, cmd from pg_policies where tablename = 'rooms' order by cmd;
