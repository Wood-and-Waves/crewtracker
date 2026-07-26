-- Allow a third meal break.
--
-- punches.punch_type is constrained to a fixed list, so the new types have to be
-- admitted before anything can write them. Purely additive: no existing punch
-- changes, and a show that never takes a third break stores nothing new.
--
-- Meal deduction and meal penalties both cover the third break on identical
-- terms, driven by MEAL_PAIRS in lib/punches.ts (see the divergence note at the
-- top of lib/payroll.ts — iOS has no third meal).

begin;

alter table punches drop constraint if exists punches_punch_type_check;

alter table punches add constraint punches_punch_type_check
  check (punch_type = any (array[
    'start',
    'meal_out',  'meal_in',
    'meal2_out', 'meal2_in',
    'meal3_out', 'meal3_in',
    'end'
  ]::text[]));

commit;
