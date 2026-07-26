-- One crew member may appear at most once per room.
--
-- StaffRoomModal's "apply to all remaining days" inserted into every future
-- same-named room with no duplicate check, and its only guard read the active
-- day's props — which are also stale if the page hasn't re-rendered since the
-- last insert. Either route produced duplicate timecards, which then both feed
-- batch punching, report totals and the CSV/PDF.
--
-- The app-side fix queries the target rooms at insert time; this index is the
-- backstop, so no future UI bug or race can reintroduce duplicates.
--
-- Semantics: keyed on crew member alone, not role — matching both the web's
-- inThisRoom() and iOS's alreadyOnRoster check. Verified against live data that
-- no legitimate "same person, two roles, one room" case exists.

begin;

-- De-dupe first, or the index cannot be created. Keeps the row with the MOST
-- punches (then the earliest) so no logged time is ever discarded.
delete from timecards
where id in (
  select id from (
    select t.id,
           row_number() over (
             partition by t.room_id, t.crew_member_id
             order by (select count(*) from punches p where p.timecard_id = t.id) desc,
                      t.created_at asc,
                      t.id asc
           ) as rn
    from timecards t
    where t.crew_member_id is not null
  ) ranked
  where rn > 1
);

-- Partial index: rows with a null crew_member_id are manually-named crew with
-- no directory link, and are not constrained.
create unique index if not exists timecards_room_crew_uniq
  on timecards (room_id, crew_member_id)
  where crew_member_id is not null;

commit;
