-- ONE SCHEDULER ON THE DEMO ORG, so a send-to-scheduling produces one email and
-- one notification rather than three (Dan, 2026-09-16). Every address in this
-- org is an alias of the same inbox, so each extra holder of the permission is
-- another copy of the same message on his desktop.
--
-- Demo org only. CrewTracker Shows is untouched.
do $$
declare
  v_org constant uuid := 'e24655eb-5514-42d3-b248-3a879677dde9';
  n int;
begin
  if (select name from organizations where id = v_org) <> 'CrewTracker Demo' then
    raise exception 'Refusing: % is not the demo organization.', v_org;
  end if;

  update memberships m
     set can_manage_scheduling = false
    from profiles p
   where p.id = m.profile_id
     and m.organization_id = v_org
     and m.can_manage_scheduling
     and p.email <> 'dan@theaudiosmith.com';
  get diagnostics n = row_count;
  raise notice 'took scheduling from % member(s)', n;
end $$;

select p.email, m.can_manage_scheduling as schedules
from memberships m join profiles p on p.id = m.profile_id
where m.organization_id = 'e24655eb-5514-42d3-b248-3a879677dde9'
order by m.can_manage_scheduling desc, p.email;
