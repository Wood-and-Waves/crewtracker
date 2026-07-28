-- Don't let a null active_organization_id lock someone out of a company they
-- genuinely belong to.
--
-- WHY THIS IS NEEDED NOW
-- ----------------------
-- Until 0009, inserting a membership set profiles.active_organization_id as a
-- side effect of the profiles<->memberships mirror. The mirror is gone, so
-- nothing sets it implicitly any more. Invite acceptance sets it explicitly
-- (lib/invite.ts), which covers every path the application has today — but that
-- is now the ONLY thing standing between a new membership and a user who cannot
-- reach it.
--
-- The failure mode is nasty and self-sealing: with a null pointer,
-- my_organization_id() returns null, the dashboard layout shows the "Almost
-- there — your account isn't linked to an organization" screen, and that screen
-- renders OUTSIDE the app shell. So the company switcher — the one control that
-- could fix it — is not on the page. The user is stuck, holding a perfectly good
-- membership, with no way out but a support call.
--
-- Falling back to their oldest live membership grants nothing extra: it can only
-- ever choose an organization they already belong to and are not deactivated
-- from. The pointer stays authoritative whenever it resolves; this is purely the
-- "it doesn't resolve" branch.
--
-- Caught by the regression suite, which failed the moment the mirror was removed.

create or replace function public.my_organization_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    -- The chosen organization, if it still resolves to a live membership.
    (select m.organization_id
       from memberships m
       join profiles p on p.id = m.profile_id
      where m.profile_id = auth.uid()
        and m.organization_id = p.active_organization_id
        and m.deactivated_at is null),
    -- Otherwise the oldest company they are actually a live member of.
    (select m.organization_id
       from memberships m
      where m.profile_id = auth.uid()
        and m.deactivated_at is null
      order by m.created_at, m.organization_id
      limit 1)
  );
$$;

-- my_perm() needs the same treatment, or permissions would resolve against a
-- different organization than my_organization_id() — the two must never
-- disagree about which company the caller is in. That disagreement is exactly
-- what caused the rate leak fixed in 0008.
create or replace function public.my_perm(p text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  m memberships%rowtype;
  v jsonb;
begin
  select mm.* into m
  from memberships mm
  where mm.profile_id = auth.uid()
    and mm.organization_id = my_organization_id()
    and mm.deactivated_at is null;

  if not found then
    return false;
  end if;

  v := to_jsonb(m) -> p;
  if v is null then
    raise exception 'my_perm: no such permission column %', p
      using errcode = 'undefined_column';
  end if;

  return coalesce(v::boolean, false);
end;
$$;
