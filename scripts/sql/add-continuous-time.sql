-- Continuous Time (iOS parity, PayrollRuleset.continuousTimeEnabled).
--
-- When enabled, crew are paid raw wrap-minus-start with NO meal break
-- deduction at all. OT and DT still apply after their thresholds. Mutually
-- exclusive with minimum_meal_break_enabled (the "Working Lunch Rule") —
-- enforced in the Edit Show UI, not here, matching iOS.
--
-- Default false, so every existing show keeps its current behaviour.

alter table payroll_rulesets
  add column if not exists continuous_time_enabled boolean not null default false;
