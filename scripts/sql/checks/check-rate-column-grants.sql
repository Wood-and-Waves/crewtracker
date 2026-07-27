-- Read-only reconnaissance for the day_rate lockdown (B2).
-- Which roles currently hold SELECT on the pay-rate columns, and is there any
-- per-column grant at all today?

select grantee, table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and column_name = 'day_rate'
order by table_name, grantee, privilege_type;

-- Table-level grants, for contrast: a column REVOKE only bites if the role
-- doesn't also hold a blanket table-level SELECT.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('timecards', 'rate_cards')
  and privilege_type = 'SELECT'
order by table_name, grantee;
