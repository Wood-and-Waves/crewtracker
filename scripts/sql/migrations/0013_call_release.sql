-- Handing a show to the scheduler: who is crewing it, and when the call was
-- approved to be crewed.
--
-- WHY
-- ---
-- The scheduler must not start filling positions until whoever built the show
-- has approved what it needs. Otherwise they crew against a call that is still
-- being edited and redo the work. This is the handoff — Dan's word for it was
-- "receive the show".
--
-- APPROVAL IS PER SHOW, NOT PER ROOM-DAY. The positions themselves live per
-- room per day, but the decision is one human moment: "this call is set, go
-- crew it". Approving each room-day separately would be fifteen clicks on a
-- five-day three-room show to express a single intent.
--
-- ENFORCED IN THE UI, NOT HERE. There is deliberately no trigger blocking
-- writes to unapproved positions, unlike the finalized-show lock. That lock
-- protects payroll integrity, which is worth a hard stop; this is workflow
-- sequencing, and in a small company the same person is often both the admin
-- and the scheduler. A gate that can strand somebody mid-job is worse than one
-- that says "not ready yet" and lets them proceed knowingly. These columns
-- record the state; the screens read them and disable accordingly, the same way
-- the locked-show controls already do.
--
-- Reversible on purpose: clearing call_approved_at pulls a show back to draft
-- when the call changes materially.

alter table public.shows
  -- The person responsible for crewing this show. Nullable: shows created
  -- before this existed, and shows nobody has handed over yet, both have none.
  add column if not exists scheduler_id uuid references public.profiles(id),
  add column if not exists call_approved_at timestamptz,
  add column if not exists call_approved_by uuid references public.profiles(id);

-- No column-level grants needed here, unlike timecards: `shows` carries
-- table-level SELECT/INSERT/UPDATE for authenticated, so new columns inherit.
-- (timecards is the exception in this schema precisely so day_rate can be
-- withheld column by column.)

create index if not exists shows_scheduler_id_idx
  on public.shows (scheduler_id) where scheduler_id is not null;

-- A scheduler must be able to SEE the show they have been handed.
--
-- Today a show is visible if you can see all shows, are in show_assignments, or
-- created it. A scheduler is typically none of those, so handing them a show
-- would otherwise hand them something invisible — and the failure would look
-- like the assignment silently not working.
--
-- This is a plain column comparison, not a reference to another table, so it
-- cannot reproduce the RLS recursion incident (that needed two tables' policies
-- pointing at each other). Everything else about the rule is unchanged, and it
-- grants nothing beyond the one show whose scheduler_id names you.
alter policy "Users see their org shows" on public.shows
  using (
    (organization_id = my_organization_id())
    AND (
      can_see_all_shows()
      OR (id IN ( SELECT show_assignments.show_id
                    FROM show_assignments
                   WHERE (show_assignments.profile_id = auth.uid())))
      OR (created_by = auth.uid())
      OR (scheduler_id = auth.uid())
    )
  );
