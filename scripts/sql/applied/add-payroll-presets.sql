-- Named payroll presets (org-level rule templates).
--
-- A preset is a STENCIL, not a live link. At show creation its values are
-- COPIED into that show's payroll_rulesets row, and the show owns them from
-- then on. Editing or deleting a preset can never alter a show that already
-- exists — critical for payroll, since a live link would retroactively rewrite
-- the hours and pay on shows you have already closed and invoiced.
--
-- Replaces the idea of a single set of "company defaults": the default is just
-- the preset flagged is_default.
--
-- iOS note: PayrollRuleset there already carries an unused `name` field (always
-- "Default"). This is the feature that field was scaffolded for.

create table if not exists payroll_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  sort_order integer not null default 0,

  -- Same rule columns, names and defaults as payroll_rulesets.
  overtime_after_hours numeric not null default 10.0,
  double_time_enabled boolean not null default false,
  double_time_after_hours numeric not null default 12.0,
  travel_rate text not null default 'halfDay',
  meal_penalty_enabled boolean not null default false,
  meal_penalty_grace_period numeric not null default 6.0,
  meal_penalty_amount numeric not null default 0.0,
  continuous_time_enabled boolean not null default false,
  minimum_meal_break_enabled boolean not null default true,
  minimum_meal_break_minutes numeric not null default 60.0,
  meal_break_deduction_cap numeric not null default 60.0,
  short_turn_penalty_enabled boolean not null default false,
  short_turn_rest_hours numeric not null default 10.0,

  created_at timestamptz not null default now()
);

-- No two presets in an org may share a name, case-insensitively. Mirrors the
-- duplicate guard the AV Roles editor already applies in the UI.
create unique index if not exists payroll_presets_org_name_uniq
  on payroll_presets (organization_id, lower(name));

-- At most one default per org, enforced by the database rather than by the UI.
create unique index if not exists payroll_presets_one_default_per_org
  on payroll_presets (organization_id) where is_default;

alter table payroll_presets enable row level security;

-- Anyone in the org can READ presets — New Show needs the list to offer them.
drop policy if exists "presets_select_own_org" on payroll_presets;
create policy "presets_select_own_org" on payroll_presets
  for select using (organization_id = my_organization_id());

-- Writes require can_manage_rulesets. Same shape as the organizations UPDATE
-- policy, which gates on can_manage_users this way.
drop policy if exists "presets_insert_own_org" on payroll_presets;
create policy "presets_insert_own_org" on payroll_presets
  for insert with check (
    organization_id = my_organization_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.can_manage_rulesets = true
    )
  );

drop policy if exists "presets_update_own_org" on payroll_presets;
create policy "presets_update_own_org" on payroll_presets
  for update
  using (
    organization_id = my_organization_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.can_manage_rulesets = true
    )
  )
  with check (
    organization_id = my_organization_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.can_manage_rulesets = true
    )
  );

drop policy if exists "presets_delete_own_org" on payroll_presets;
create policy "presets_delete_own_org" on payroll_presets
  for delete using (
    organization_id = my_organization_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.can_manage_rulesets = true
    )
  );

-- Seed one "House Standard" per org that has no presets yet, so the feature is
-- usable immediately and New Show has something to offer. Idempotent.
insert into payroll_presets (organization_id, name, is_default, sort_order)
select o.id, 'House Standard', true, 0
from organizations o
where not exists (
  select 1 from payroll_presets pp where pp.organization_id = o.id
);
