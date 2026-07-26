-- Final Report email: a PM-triggered end-of-show sign-off that sends the
-- complete payroll report — INCLUDING financials — to addresses an admin
-- designates, without the PM ever seeing the figures.
--
-- Recipients live on the org, not the show: one admin-managed list, used for
-- every show. The route reads them server-side and never accepts them from the
-- client — if it did, a PM could mail the financials to themselves.
--
-- Sending locks the show. finalized_by / final_report_recipients are an audit
-- snapshot: who signed off, when, and who it went to. An admin can unlock,
-- which clears finalized_at but leaves the audit fields intact.

alter table organizations
  add column if not exists final_report_emails text;

alter table shows
  add column if not exists finalized_at timestamptz,
  add column if not exists finalized_by uuid references profiles(id),
  add column if not exists final_report_recipients text;

comment on column organizations.final_report_emails is
  'Comma-separated recipients for the end-of-show Final Report email. Admin-managed; never supplied by the client.';
comment on column shows.finalized_at is
  'Set when the Final Report is sent. Non-null means times are locked.';
