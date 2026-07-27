create policy "rooms_update_own_org" on rooms
for update
using (
  work_day_id in (
    select wd.id from work_days wd
    join shows s on s.id = wd.show_id
    where s.organization_id = my_organization_id()
  )
)
with check (
  work_day_id in (
    select wd.id from work_days wd
    join shows s on s.id = wd.show_id
    where s.organization_id = my_organization_id()
  )
);

create policy "rooms_delete_own_org" on rooms
for delete
using (
  work_day_id in (
    select wd.id from work_days wd
    join shows s on s.id = wd.show_id
    where s.organization_id = my_organization_id()
  )
);
