-- Multi-organization data model, step 2 of 3: point the helpers at memberships.
--
-- THE WHOLE PLAN RESTS ON THIS FILE
-- ---------------------------------
-- 32 of the 43 RLS policies never mention `profiles`; they go through
-- my_organization_id() or can_see_all_shows(). If those two keep their existing
-- contract — one organization id, one boolean, null/false when the caller has no
-- business here — then those 32 policies are correct after this change without
-- being touched at all. That is the difference between a change we can verify
-- and a 43-policy rewrite we cannot.
--
-- Resolution is now: caller -> their profile's active_organization_id -> the
-- membership for that org, which must exist and not be deactivated. Every step
-- can fail, and every failure returns null/false, which denies. There is no path
-- through these functions that grants more than before.
--
-- WHY A POINTER (active_organization_id) RATHER THAN "their only org"
-- ------------------------------------------------------------------
-- Once a person can hold several memberships, "their org" stops being a fact and
-- becomes a choice, and my_organization_id() still has to return exactly one
-- value or all 32 policies break. Storing the choice is what keeps the contract.
-- It is also the main new risk in this design — a wrong active_organization_id
-- serves another organization's data — which is why the join below re-checks
-- that a live membership for that exact org exists, every single time. The
-- pointer alone never grants anything.

-- ============================================================
-- my_perm — one permission lookup for every policy to share
-- ============================================================
-- The 11 policies that read profiles all have the identical shape
-- `(select can_X from profiles where id = auth.uid())`. Rewriting each to query
-- memberships would mean rewriting each of them again the next time this model
-- moves. Routing them through one function means the next change is one edit
-- here, which is the same reason my_organization_id() exists.
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
  join profiles pr on pr.id = mm.profile_id
  where mm.profile_id = auth.uid()
    and mm.organization_id = pr.active_organization_id
    and mm.deactivated_at is null;

  if not found then
    return false;                       -- no live membership: grant nothing
  end if;

  v := to_jsonb(m) -> p;
  if v is null then
    -- A misspelled permission would otherwise silently deny everything, which
    -- looks like a broken feature rather than a broken policy. Fail loudly; dev
    -- is where this gets caught. (CLAUDE.md: surface errors, don't fail silently.)
    raise exception 'my_perm: no such permission column %', p
      using errcode = 'undefined_column';
  end if;

  return coalesce(v::boolean, false);
end;
$$;

-- ============================================================
-- my_organization_id — unchanged contract, new source
-- ============================================================
-- Was: select organization_id from profiles where id = auth.uid()
--                                             and deactivated_at is null
create or replace function public.my_organization_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.organization_id
  from memberships m
  join profiles p on p.id = m.profile_id
  where m.profile_id = auth.uid()
    and m.organization_id = p.active_organization_id
    and m.deactivated_at is null;
$$;

-- ============================================================
-- can_see_all_shows / can_manage_users_me
-- ============================================================
-- can_see_all_shows previously returned NULL (not false) for a deactivated user.
-- Both are only ever used in boolean OR/AND positions where NULL and false deny
-- identically, so returning false is the same behaviour with one less way to be
-- surprised later.
create or replace function public.can_see_all_shows()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$ select public.my_perm('can_edit_all_shows'); $$;

-- Note a real (deliberate) tightening: the old version did NOT check
-- deactivated_at, so a removed admin still reported true here. Every policy
-- using it also requires organization_id = my_organization_id(), which already
-- returned null for a deactivated user, so nothing was actually reachable — the
-- gap was latent, not exploitable. It is closed now rather than carried forward.
create or replace function public.can_manage_users_me()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$ select public.my_perm('can_manage_users'); $$;
