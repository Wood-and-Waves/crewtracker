-- timecards had SELECT/INSERT/UPDATE policies but no DELETE, so a direct
-- client-side delete (un-staffing a crew member, or removing someone from the
-- directory who has been staffed) was silently blocked by RLS. Room deletion
-- still worked only because DB cascade bypasses child-table RLS.
-- Scope matches the existing UPDATE policy exactly (org's own shows).
create policy "Users delete timecards for their org shows" on timecards
for delete using (
  room_id in (
    select r.id from rooms r
    join work_days wd on wd.id = r.work_day_id
    join shows s on s.id = wd.show_id
    where s.organization_id = my_organization_id()
  )
);
