-- THE PAY-RATE GUARD'S "DROP THE RATE" BRANCH HAS NEVER WORKED.
--
-- enforce_pay_rate_write_permission() refuses an UPDATE from somebody without
-- can_edit_pay_rates, and on INSERT it deliberately does NOT refuse the row —
-- it drops the rate instead, so staffing keeps working for a scheduler who has
-- no business seeing money. Its own comment says so: "INSERT: drop the rate
-- rather than refuse the row."
--
-- Except it drops it to NULL, and rate_cards.day_rate is NOT NULL DEFAULT 0.0.
-- So the row is refused anyway, with a constraint violation rather than a
-- permission error:
--
--   null value in column "day_rate" of relation "rate_cards"
--   violates not-null constraint
--
-- Postgres applies column defaults BEFORE a BEFORE-INSERT trigger runs, so
-- omitting day_rate does not dodge it either: the default makes it 0.0, which
-- is not null, so the early return never fires and the guard nulls it anyway.
-- There is no way for an unprivileged caller to insert a rate card at all.
--
-- Nobody had hit it because nothing without the permission had ever inserted
-- one — staffing writes `timecards`, not `rate_cards`. It surfaced on
-- 2026-10-01 when adding somebody from the Scheduling screen started recording
-- the role they were hired for, which is a rate_cards write performed by a
-- scheduler (Dan: "the directory should reflect that they are an A1 so they can
-- be scheduled on the next show").
--
-- DROPPING TO 0 IS WHAT THE SCHEMA ALREADY MEANS BY "no rate". The column is
-- NOT NULL DEFAULT 0.0, so 0 is the only expressible unset — and 0 is also a
-- real rate for genuinely unpaid crew, which is why CLAUDE.md says never to
-- test day_rate for truthiness. Either way this is strictly what the branch was
-- always trying to do.
--
-- IT GRANTS NOBODY ANYTHING NEW. Without the permission you still cannot set a
-- rate: UPDATE still raises, and INSERT still discards whatever was supplied.
-- The only change is that the row now lands, which is what the guard intended.

create or replace function public.enforce_pay_rate_write_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  if (select my_perm('can_edit_pay_rates')) then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    raise exception 'You do not have permission to change pay rates.'
      using errcode = 'check_violation';
  end if;

  -- INSERT: drop the rate rather than refuse the row. ZERO, not null — the
  -- column is NOT NULL DEFAULT 0.0, and nulling it turned this branch into a
  -- constraint violation, which is the opposite of letting the row through.
  NEW.day_rate := 0;
  return NEW;
end;
$$;
