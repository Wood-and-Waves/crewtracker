-- Stage 4 of the day_rate lockdown: make can_edit_pay_rates a real boundary.
--
-- Stage 3 stopped users READING a rate they aren't entitled to. They could still
-- WRITE one — change a figure they cannot see. This closes that.
--
-- WHY A TRIGGER RATHER THAN COLUMN PRIVILEGES
-- -------------------------------------------
-- Same reason the reads went through a view: every signed-in user shares the one
-- `authenticated` role, so revoking UPDATE(day_rate) would block admins too.
-- A trigger can look up the actual caller and decide per user, which is the only
-- thing that expresses "this person may set rates, that one may not."
--
-- INSERT vs UPDATE are treated differently, deliberately:
--
--   UPDATE  -> RAISE. Changing an existing rate is always a deliberate act. An
--             error is the honest response, and it surfaces in the UI.
--
--   INSERT  -> silently drop the supplied rate. Inserting a timecard is how a PM
--             staffs crew, which is their job and must keep working. Their UI
--             shows no rate field at all, so any value arriving from them is
--             incidental (a stale form value, a copied roster). Dropping it lets
--             inherit_show_day_rate fill in the show's real rate. Raising here
--             would break staffing for exactly the people who need it most.
--
-- Two exemptions, both necessary:
--   * pg_trigger_depth() > 1 — the write came from another trigger, i.e. the
--     show-wide rate propagation cascade. Its originating write was already
--     authorised; re-checking would make every permitted rate edit fail.
--   * auth.uid() is null — no end user in context (service role, migrations,
--     the Final Report route). RLS still governs which rows are reachable.

begin;

create or replace function enforce_pay_rate_write_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_may_edit boolean;
begin
  -- System cascade or no user in context: not a user-initiated rate change.
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.day_rate is not distinct from OLD.day_rate then
    return NEW;                       -- rate untouched; nothing to authorise
  end if;

  if TG_OP = 'INSERT' and NEW.day_rate is null then
    return NEW;                       -- no rate supplied
  end if;

  select coalesce(p.can_edit_pay_rates, false) into v_may_edit
  from profiles p where p.id = auth.uid();

  if coalesce(v_may_edit, false) then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    raise exception 'You do not have permission to change pay rates.'
      using errcode = 'check_violation';
  end if;

  -- INSERT: drop the rate rather than refuse the row.
  NEW.day_rate := null;
  return NEW;
end;
$$;

-- Name sorts AFTER timecards_blocked_when_finalized (a locked show is rejected
-- first) and BEFORE timecards_inherit_show_day_rate, so this sees the value the
-- caller actually sent rather than one the inherit trigger just filled in.
drop trigger if exists timecards_check_pay_rate_permission on timecards;
create trigger timecards_check_pay_rate_permission
before insert or update on timecards
for each row
execute function enforce_pay_rate_write_permission();

drop trigger if exists rate_cards_check_pay_rate_permission on rate_cards;
create trigger rate_cards_check_pay_rate_permission
before insert or update on rate_cards
for each row
execute function enforce_pay_rate_write_permission();

commit;
