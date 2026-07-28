-- Indexes for the schedule view.
--
-- WHY
-- ---
-- Every screen until now has been scoped to ONE show, so the app has only ever
-- walked this chain downward from a known show id. The schedule asks the
-- opposite question — "who is working between these two dates, across every
-- show" — which drives from `work_days.date` and joins outward:
--
--     work_days (by date) → rooms (by work_day_id) → timecards (by room_id)
--
-- Not one step of that path is indexed today:
--   * `work_days` has only its primary key and `(show_id, date)`. That composite
--     cannot serve a date-range scan across all shows — wrong leading column.
--   * `rooms.work_day_id` and `punches.timecard_id` have no index at all.
--   * `timecards.room_id` is only covered by `timecards_room_crew_uniq`, which is
--     PARTIAL (`where crew_member_id is not null`) and therefore misses every
--     manually-named crew member.
--
-- Irrelevant at today's size — dev has 36 work days — and that is exactly why it
-- is worth doing now, while the tables are small enough that adding an index is
-- instant and uninteresting. This is about to become the app's most-used screen.
--
-- `punches.timecard_id` is included even though the schedule does not read
-- punches: it is the join behind every report and the tracker's own load, and it
-- has been missing all along.
--
-- Plain `create index`, not `concurrently`. The migration runner wraps each file
-- in a transaction, which `concurrently` cannot join — a failure would then leave
-- a half-built index behind. At beta size the brief lock is imperceptible.

create index if not exists work_days_date_idx        on public.work_days (date);
create index if not exists rooms_work_day_id_idx     on public.rooms (work_day_id);
create index if not exists timecards_room_id_idx     on public.timecards (room_id);
create index if not exists timecards_crew_member_idx on public.timecards (crew_member_id);
create index if not exists punches_timecard_id_idx   on public.punches (timecard_id);
