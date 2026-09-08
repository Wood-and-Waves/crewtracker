# The Scheduling screen — design

> **BUILT 2026-09-08**, inline, no subagents. Plan:
> `docs/superpowers/plans/2026-09-07-scheduling-screen.md`. On the `scheduling` branch (preview
> only until merged). What shipped matches this spec, with three decisions recorded in CLAUDE.md:
> the strip's counting rules, day activities stay read-only here, and travel-at-booking did not
> move across.

Agreed with Dan in conversation on 2026-09-07 (late evening), after piece C shipped to
production. Not yet planned; the plan comes next (`writing-plans`), then an inline build —
**no subagents, no model other than the session's without Dan's explicit yes** (see the memory
`no-subagents-without-approval`). Dan wants to demo the program the week of 2026-09-08.

## Why

The tracker's room ⋮ menu is carrying two jobs for two different people on two different days.
Dan: *"Too much lives there. I think we need to rethink the scheduler page. Maybe scheduling is
separate from the tracker."* And, repeatedly: *"the tracker should be simple."*

- **The tracker is show day.** The PM, on a phone, in the dark: who is here, punch them, flag
  travel. The room's ⋮ holds ROOM jobs only — rename, delete, edit crew.
- **Scheduling is weeks earlier, at a desk.** Positions, filling, asking, answers, flags. That
  gets its own screen, desktop-first like New Show.

## Decisions (Dan's words where they matter)

| Question | Answer |
|---|---|
| Where | One screen per show: `/dashboard/shows/[id]/schedule`, reached from the show's header beside Edit Show and View Report, and from every Needs-scheduling row (a scheduler never has to open a tracker). Desktop-first; usable on an iPad; not optimised for a phone. |
| Shape | **A grid, rooms down the side, days across the top** — the same shape as New Show's positions grid. Built 2026-09-08 as ruled POSITION LINES: a room is a strip, and under it one row per position running the width of the show, so a person sits in the same row every day and nothing shifts when a role runs on only some days. |
| A cell | Tap **Open** → the Fill picker (with its days checklist, its "Already scheduled on / pending on" lines, "Declined this show"). Tap a **chip** → Confirmed / Declined (the same in-place menu as the tracker's chip). A **flag** (a booked day that no longer fits its definition) shows in place with Move / Keep / Release. |
| Above the grid | The show's state and its actions in one strip: "12 of 20 confirmed · 3 waiting · 2 open"; Send to scheduler / With scheduling since … / Take back; **Ask everyone pencilled**; the PM's name and a chip that records their answer (added 2026-09-08: the same pill actions as a crew member, because a PM says yes on the phone too); the day-activities row (it explains which cells exist). |
| Positions themselves | The definitions editor (role × count × kind of day) lives here too, under the grid — Edit Show keeps it as well until nobody misses it there. |
| What leaves the tracker | The ⋮ → Positions panel, the Fill picker, and the open-position rows. The tracker keeps ONE scheduling thing: the status chip, shown **only while an answer is owed** (pencilled / asked), with Confirmed / Declined behind it. A confirmed person's row is just name and role. |
| Tap-to-decline a confirmed person | Not on the tracker (nothing to tap). On the Scheduling screen, a confirmed chip is tappable → Declined. |
| Emails | Unchanged: declines instant to every scheduler; the scheduler digest for accepts is a separate backlog item. |
| Terminology | "positions", never "call". The menu says **Confirmed / Declined** — the statuses themselves (Dan, 2026-09-08; it read "Approved" until then), never "confirmed by phone" or "backed out": *"Simplicity and less verbiage is key."* |

## What already exists (do not rebuild)

`FillPositionPicker` (checklist, conflict lines, decline warning), `BookingStatusChip`
(Confirmed / Declined menu, `/api/bookings/record`), `PositionDefsEditor` /
`PositionDefsSection` (definitions + flags with Move / Keep / Release), `AskPencilledButton`,
`SendToSchedulingButton`, `PmField`, `DayActivitiesGrid`, `lib/schedulingQueue.ts`,
`lib/positionDefs.ts`, `position_slot_flags`, `sync_position_slots`. The screen is composition,
not new mechanics: one page that reads a show's rooms × days × slots × timecards and lays them
out, with those components dropped into the cells and the strip. One new query shape (all
slots for a show with their live timecard and status), no migration expected.

## Proof

`schedule.mts` for the grid model (cells from slots + timecards; flags placed; counts in the
strip). Dan tries it on the preview with an 8-day, two-room show: fill, approve, decline, retag
a day and sort the flag, Ask everyone pencilled, Take back — all without opening the tracker.
Then the tracker's ⋮ Positions / Fill / open rows are removed in the same piece, once the
screen does everything they did.
