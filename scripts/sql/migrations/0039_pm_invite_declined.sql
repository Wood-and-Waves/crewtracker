-- A production manager's decline is RECORDED, so it can be reversed.
--
-- Dan, 2026-09-08: "A click from the email is definitive. There can be a
-- reversal, but a decline click in the email should not bring up another
-- decline button." Declining from the email now happens on the click — and
-- until this migration that path DELETED the invitation, which left the token
-- dead: no way back, and no way to add a note afterwards.
--
-- So the invitation survives a decline and carries the answer, the same shape
-- booking_invites has used for crew since 0014. The SHOW still goes back to
-- having no production manager (pm_profile_id cleared, the source='pm'
-- assignment removed) — that part was right, and it is what makes "no PM"
-- honest on the Scheduling screen.
--
-- `replaced` is now "somebody ELSE holds this show", not "this show does not
-- point at me": a declined invitation points at nobody, and must still open.
--
-- Writes no rows.

alter table public.pm_invites
  add column if not exists declined_at timestamptz,
  add column if not exists declined_note text;

comment on column public.pm_invites.declined_at is
  'They said no. The row stays so the decline can be reversed and a note added.';
comment on column public.pm_invites.declined_note is
  'What they wanted whoever named them to know. Sent on, verbatim.';
