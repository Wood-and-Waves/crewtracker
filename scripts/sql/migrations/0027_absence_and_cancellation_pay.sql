-- No-show and Cancelled days, and what a cancelled day pays.
--
-- Dan (2026-09-06): a person who was booked but did not work a day is one of
-- two DIFFERENT things — they did not show up (their fault, pays nothing) or
-- the company cancelled them (our call, pays a contractual fee). One column,
-- two values: a day cannot be both, so the choice is structural rather than
-- two booleans a bug could set together. NULL is the everyday case — they
-- worked, or nothing has been decided.
--
-- What a cancelled day pays is a property of the payroll RULES, per show and
-- per preset like every other rule, as a percentage of the day rate:
-- 0 (default — nothing changes for any existing show), 50, 100, or whatever
-- the client's contract says. A no-show has no such setting: it pays nothing.
--
-- The calculator (lib/payroll.ts) treats an absent day as zero hours and
-- either zero pay or day_rate × the percentage. Zero hours means it can never
-- be "the previous day" for the short-turnaround rest rule — nobody worked.
--
-- Column grants: timecards is COLUMN-granted (the day_rate lockdown), so the
-- new column is invisible to the app until granted — the same trap 0015 and
-- 0023 record. The two payroll tables are table-granted and need nothing.
-- db:grants after this reaches production.

alter table public.timecards
  add column if not exists absence text
  check (absence in ('no_show', 'cancelled'));

grant select (absence), insert (absence), update (absence) on public.timecards to authenticated;

alter table public.payroll_rulesets
  add column if not exists cancellation_pay_percent numeric not null default 0
  check (cancellation_pay_percent >= 0 and cancellation_pay_percent <= 100);

alter table public.payroll_presets
  add column if not exists cancellation_pay_percent numeric not null default 0
  check (cancellation_pay_percent >= 0 and cancellation_pay_percent <= 100);
