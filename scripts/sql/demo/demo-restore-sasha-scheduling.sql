-- Give Sasha the scheduling permission back — the demo persona the Scheduling
-- screen was built for. Run this when the video is done.
update memberships m set can_manage_scheduling = true
from profiles p
where p.id = m.profile_id
  and m.organization_id = 'e24655eb-5514-42d3-b248-3a879677dde9'
  and p.email = 'dan+sasha@theaudiosmith.com';
select p.email, m.can_manage_scheduling from memberships m
join profiles p on p.id = m.profile_id
where m.organization_id = 'e24655eb-5514-42d3-b248-3a879677dde9'
order by 2 desc, 1;
