alter table profiles
  add column if not exists use_24_hour_time boolean not null default false,
  add column if not exists shoulder_surfer_mode boolean not null default false;

alter table organizations
  add column if not exists timecard_rounding_minutes integer not null default 1,
  add column if not exists default_cc_email text;

create policy "org_admins_update_own_org" on organizations
for update
using (
  id = my_organization_id()
  and exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.can_manage_users = true
  )
)
with check (
  id = my_organization_id()
  and exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.can_manage_users = true
  )
);
