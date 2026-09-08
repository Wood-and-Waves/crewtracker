-- Colleagues can see each other's NAMES.
--
-- Found 2026-09-08 on the Scheduling screen: the strip read "PM: them" for a
-- scheduler, because she could not read the production manager's profile.
--
-- WHY IT WAS BROKEN. The profiles rule asks "is there a membership for this
-- person in my organization?", and that subquery runs under the CALLER's own
-- RLS. The memberships rule is "your own row, or the whole company if you hold
-- can_manage_users" — so a non-admin can see exactly one membership row, their
-- own, and therefore could read exactly one profile: their own. Every
-- colleague's name was invisible to everybody who is not an admin. Nothing to
-- do with the scheduling work; it has been true since multi-org shipped, and
-- the Scheduling screen is simply the first place a non-admin is shown a
-- colleague's name.
--
-- THE FIX IS A DEFINER HELPER, NOT A WIDER MEMBERSHIPS RULE. A membership row
-- carries all eighteen permission flags, and "who may see everyone's
-- permissions" is a separate question from "who may see a colleague's name".
-- shares_my_organization() answers only the second, bypassing memberships RLS
-- inside the function the way my_organization_id() already does.
--
-- The call is per-row by construction: it takes the row's own id, so it cannot
-- be hoisted into an InitPlan the way (select my_perm(...)) is. That is
-- acceptable HERE and nowhere hotter — profiles reads are one row (a PM's name)
-- or a handful (a member list), never a table scan, and the function is a
-- single indexed lookup. Do not copy this shape onto punches or timecards; see
-- the 0021 incident in CLAUDE.md.
--
-- Writes no rows.

create or replace function public.shares_my_organization(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from memberships m
    where m.profile_id = p_profile
      and m.organization_id = (select public.my_organization_id())
      and m.deactivated_at is null
  );
$$;

revoke execute on function public.shares_my_organization(uuid) from public;
grant execute on function public.shares_my_organization(uuid) to authenticated;

-- Same shape as before, with the membership test moved inside the function so
-- it is not filtered away by the caller's own view of `memberships`.
alter policy "Users see profiles in their org" on public.profiles
  using (
    id = (select auth.uid())
    or shares_my_organization(id)
  );
