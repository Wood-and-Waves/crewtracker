-- An eighth kind of day: Show/Load-out.
--
-- WHY A SECOND MIGRATION RATHER THAN AN EDIT TO 0015
-- --------------------------------------------------
-- 0015 has been applied. The runner refuses to re-run an edited migration
-- (checksum mismatch), and rightly so: dev already holds what the original did,
-- so quietly changing the file would leave the two databases describing
-- themselves the same way while actually differing. A new migration is the only
-- honest fix. This one is the whole reason the constraint was written as a
-- named CHECK rather than a Postgres enum type — adding a value is a constraint
-- swap, not a type alteration.
--
-- The order these appear in a dropdown is NOT here. It lives in the array in
-- lib/dayTypes.ts, which is why Show/Load-out can slot between 'show' and
-- 'load_out_travel' without the database caring. The constraint only answers
-- "is this a value we recognise".
--
-- Same rule as 0015 and unchanged by this: day_type is planning information.
-- lib/payroll.ts never reads it.
--
-- No grant or policy work needed — 0015 already granted UPDATE on this column
-- and created the policy. This only widens what the column will accept.

alter table public.work_days
  drop constraint if exists work_days_day_type_check;

alter table public.work_days
  add constraint work_days_day_type_check check (
    day_type is null or day_type in (
      'travel_load_in',
      'load_in',
      'load_in_show',
      'rehearsal',
      'show',
      'show_load_out',
      'load_out_travel',
      'travel'
    )
  );
