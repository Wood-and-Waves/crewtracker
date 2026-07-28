-- Multi-organization, fix: profiles' own policies still used the legacy column.
--
-- THE BUG THIS FIXES
-- ------------------
-- Switching organization set profiles.active_organization_id, and everything
-- downstream resolved correctly — my_organization_id() returned the new org, the
-- membership was found, shows and crew scoped properly. And yet the app showed
-- "Almost there", as though the user belonged to nothing.
--
-- The cause: profiles' SELECT policy read
--     organization_id = my_organization_id()
-- where organization_id is the LEGACY column, now a derived copy maintained by
-- the reverse mirror — and the mirror only fires when a MEMBERSHIP changes.
-- Switching changes no membership, so the column still named the previous
-- organization while my_organization_id() named the new one. They disagreed, the
-- policy failed, and the user could no longer read THEIR OWN PROFILE ROW. Every
-- lookup that starts from the profile then returned nothing.
--
-- Worth recording as a class of bug, not a one-off: while a legacy column is
-- being retired, any POLICY still reading it is a landmine. The data can be
-- perfectly correct and access still collapses, and it fails as "you belong to no
-- organization" rather than as an error — which points investigation at exactly
-- the wrong place. This was invisible until a real two-organization user existed.
--
-- Both policies below now resolve through memberships, and the SELECT policy
-- always lets you see yourself, which should never have depended on an
-- organization at all.

-- ============================================================
-- SELECT: yourself, plus anyone you share an organization with
-- ============================================================
drop policy if exists "Users see profiles in their org" on public.profiles;
create policy "Users see profiles in their org" on public.profiles
  for select using (
    -- You can always see yourself. Independent of any organization, so a person
    -- between organizations still has a working account rather than an app that
    -- cannot load their name.
    id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.profile_id = profiles.id
        and m.organization_id = my_organization_id()
    )
  );

-- ============================================================
-- UPDATE: admins may edit profiles of people in their organization
-- ============================================================
-- Largely vestigial now that permissions live on the membership, but it still
-- guards person-level fields, and leaving it pointed at the stale column would
-- reintroduce the same failure the moment someone switched.
drop policy if exists "Admins can manage org member permissions" on public.profiles;
create policy "Admins can manage org member permissions" on public.profiles
  for update
  using (
    my_perm('can_manage_users')
    and exists (
      select 1 from public.memberships m
      where m.profile_id = profiles.id
        and m.organization_id = my_organization_id()
    )
  )
  with check (
    my_perm('can_manage_users')
    and exists (
      select 1 from public.memberships m
      where m.profile_id = profiles.id
        and m.organization_id = my_organization_id()
    )
  );

-- Note on recursion: profiles' policies query memberships, and memberships'
-- policies call my_organization_id() / my_perm(), which are SECURITY DEFINER and
-- therefore read as the table owner without re-entering policy evaluation. No
-- cycle between the two tables' policies, which is the shape that actually
-- triggers Postgres's recursion guard. Verified on dev after applying.
