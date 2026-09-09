-- Read-only: how many staffing changes nobody has passed on to the crew member.
-- Right after migration 0040 this must be 0 — the backfill counts all history
-- as told, so the Scheduling screen does not open on a backlog nobody can act
-- on. In normal use it is the number the screen shows.
select count(*) as total,
       count(*) filter (where crew_told_at is null) as untold
from staffing_events;
