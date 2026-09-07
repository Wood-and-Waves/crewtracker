# The show flow, front to back — design

Decided with Dan, 2026-09-07, after rolling back the schedule grid ("we are building the end
before the start"). This spec covers creating a show through the show being staffed and the
PM being kept informed. It supersedes Section 4 of
`2026-09-06-show-access-and-schedule-design.md` (the grid) and adjusts its scheduler door.
Sections 1–3 and 5 of that spec (the email link, PM-side/crew-side, the crew screen, unlock)
are built and on production and stay as they are.

Built in three pieces, each tried live by Dan before the next: **A. the day grid → B. positions
by kind, the PM field, the two finish buttons → C. the scheduling queue, the ready email, the
digest, day-change flags, crew change notices.**

## Decisions

| Question | Dan's answer |
|---|---|
| Day types | Five **activities** a day can carry — Travel, Load-in, Rehearsal, Show, Load-out — as a grid of toggles that appears once the dates are entered. Label and colour are derived. |
| Who creates a show, knowing what | Sales/office: dates, venue, rooms, **headcount by role** — not names. |
| Naming the PM | An **optional** field on New Show (and Edit Show). Naming one **offers** an email, like a booking request — never automatic. |
| Who fills positions | **The scheduler, always.** |
| Handoff | New Show has **two buttons**: "Create show" and "Create show and send to scheduler". Edit Show keeps "Send to scheduler". |
| Who is "the scheduler" | **Everyone with the scheduling permission.** Nobody owns a show; any of them can fill any position. |
| What schedulers see | **Only shows that have been sent to scheduling.** A show still being built is out of sight. |
| PM before show day | A **ready email**, automatic, **when the last position is accepted** — to a PM who has **accepted** the show. No PM yet? It is held and sent the moment one accepts. Roster by day and room with phones, each person's days, anyone still waiting. |
| Changes after that | An automatic **evening digest** to the PM, each line marked accepted / waiting on reply / declined. Starts only after the ready email. |
| A person's days | **A position is "a role, for these kinds of day"**: all days / show days / load-in and load-out / custom dates. Filling it gives the person those days by default, with a checklist to trim. |
| A day added or removed later | The app **adds open slots freely and never removes a person on its own**. A booked person on a day that no longer fits becomes a **flag for a human** (move / keep / release). All-day people are offered an extension to a new day. |
| Telling crew about changes | **Offered** to whoever made the change ("Tell the 6 crew whose days changed?"). |

---

## A. The day grid

**What.** `work_days` stops carrying one of eight compound labels and carries a **set of
activities**: `activities text[]` with values from `{travel, load_in, rehearsal, show,
load_out}`. A day may carry any combination, including none.

**Migration.** Add the column; backfill from `day_type` (`travel_load_in` → `{travel,
load_in}`, `load_in_show` → `{load_in, show}`, `show_load_out` → `{show, load_out}`,
`load_out_travel` → `{load_out, travel}`, the four plain ones → their single activity, null →
`{}`); keep `day_type` for one release as a read-only mirror, then drop it. `0015`'s UPDATE
grant/policy on `work_days` already covers the write.

**Derived, in `lib/dayTypes.ts`** (renamed `lib/dayActivities.ts`; the old exports become
thin wrappers until every caller moves):
- `dayLabel(activities)` → "Show · Load-out" in chronological order; "" for none.
- `dayTint(activities)` → the day's **biggest** activity decides the colour: show > rehearsal >
  load-in > load-out > travel (load-in and load-out share the amber). Same four tokens.
- `isKindOfDay(activities, kind)` for Section B: `show` = has show; `load` = has load_in or
  load_out; `all` = every day; `custom` = never (dates are explicit).

**UI.** A grid: one row per day (date, weekday), five toggle squares, and a "Reads as" column
showing the derived label under a tint bar. Appears on New Show once both dates are set, in
the place Day Types sits today, and on Edit Show (`components/DayActivitiesGrid.tsx`,
replacing `DayTypePicker`). Each toggle is a verified write on Edit Show; on New Show it is
state until the show is created. Keyboard: arrows and space.

**Readers to update.** Tracker day strip, Edit Show, `CrewCallGrid` headers, the booking
request email and page (`lib/bookingEmail.ts`, `lib/bookingInvite.ts`,
`app/api/bookings/send`), `MobileRoomTracker`. All go through the two derived functions.

**Untouched.** Per-person travel (`timecards.is_travel_day / travel_in_day / travel_out_day`)
and `lib/payroll.ts`. A day being a travel day for the show says nothing about any person.

---

## B. Positions by kind, the PM field, the two finish buttons

**Positions by kind.** Today a position is one `crew_call_positions` row per room per day, and
sales enters counts per cell of the rooms × days grid. That per-day row stays — it is what the
scheduler fills and the booking email reads — but it gains a parent:

```
position_defs (id, show_id, room_name text, role text, count int,
               day_kind text check in ('all','show','load','custom'),
               custom_dates date[] null, created_at)
crew_call_positions gains position_def_id uuid null references position_defs
```

A definition says "2 Stagehands in the Ballroom, load-in and load-out". Its per-day slots are
**derived**: for every work day where `isKindOfDay(day.activities, day_kind)` (or the date is
in `custom_dates`) and the room exists that day, `count` slots. Slots are (re)generated by one
function, `sync_position_slots(show_id)`, which:
- **adds** missing slots (open, unfilled);
- **removes** only slots that are **unfilled** and no longer derived;
- **never touches a filled slot** — a filled slot whose day no longer fits becomes a **flag**
  (a view: `position_slot_flags` = filled slots not currently derived by their definition),
  shown on Edit Show and on the scheduler's list with three actions: move to another open slot
  of the same definition, keep (converts that slot to a custom one-off), release (frees it).

Run after: a definition changes, the day grid changes (a toggle), a room is added to or removed
from a day, Add Day / remove day. Definitions with `day_kind = 'custom'` ignore the day grid.
Legacy rows with no `position_def_id` keep working exactly as today (they are their own
definition, per day).

**New Show, step 3 → "Rooms & Positions".** Rooms × days grid stays for *which rooms run which
days*. Positions move to a short list per room: role, count, kind picker ("All days · Show
days · Load-in and load-out · Custom…"). Default kind: **all days** — today's behaviour.

**Production manager.** `shows.pm_profile_id uuid null references profiles`. Naming one (New
Show field, Edit Show field) writes a `show_assignments` row for them (that is what gives
access — the PM-side door already exists) and offers **"Email Sam that they're the PM?"** —
`lib/pmAssignedEmail.ts`, the booking-request sender, `siteOrigin()` for the link. The email
carries an **Accept** button (a token link, like a booking request, landing on the show);
`shows.pm_accepted_at` records it. Opening the show while signed in as the PM counts as
accepting too, so nobody is blocked on a button. Changing the PM clears `pm_accepted_at` and
removes the old assignment only if it was created by this field (tracked by
`show_assignments.source = 'pm'`), never one an admin granted by hand.

**Two finish buttons.** "Create show" (today's) and "Create show and send to scheduler" =
create, then the Section C handoff. Both land on the new show's tracker.

**Filling a position** (scheduler): `FillPositionPicker` gains a day checklist — the
definition's derived days, all ticked, travel in/out untickable here (per-person travel stays
on the tracker/timecard). Unticking a day leaves that slot open for someone else. Booking rows
(`timecards`) are created for the ticked days only, as today's fill does per slot.

---

## C. The scheduling queue, the ready email, the digest, flags, crew change notices

**Send to scheduler.** `shows.sent_to_scheduling_at timestamptz null` (set by the button on
New Show or Edit Show; cleared by "Take back from scheduling"). Sends **one email to every
member with `can_manage_scheduling`** (`lib/callHandoffEmail.ts` adapted: "Northwind needs
scheduling — 14 positions, Sep 4–9"). `shows.scheduler_id` stops being written; it stays for
history until a later migration drops it, once nothing reads it.

**What schedulers see.** The shows visibility rule's scheduler door becomes
`(select my_perm('can_manage_scheduling')) and sent_to_scheduling_at is not null` (replacing
`scheduler_id = auth.uid()`); the same arm in `timecard_day_rates`, `my_pm_show_ids()` and
the punch/timecard policies (0030) — schedulers are **PM-side** on sent shows. The Schedule
screen gains a **"Needs scheduling"** list: sent shows with any open slot, oldest first.

**Ready email** — automatic, and **only to an accepted PM**. One function,
`maybeSendReadyEmail(showId)`, called after a crew acceptance (`/api/bookings/respond`) AND
after a PM accepts (the Accept link, or first signed-in open): if the show has **no open slot
and no booking waiting on a reply**, `pm_accepted_at` is set, and `ready_email_sent_at` is
null → send `lib/readyEmail.ts` to the PM and set `ready_email_sent_at`. A show that fills
before it has a PM simply waits; the email goes the moment the PM accepts. Body: roster by day
and room (name, role, phone), each person's days in one line ("Sam Lindqvist · A1 · Tue–Thu"),
and "0 waiting on a reply". Idempotent by the timestamp; a later change that reopens a slot
does NOT unsend or resend it.

**Evening digest** — automatic, only after `ready_email_sent_at` (so only ever to an accepted PM). A `staffing_events` table
(show_id, at, kind: booked / accepted / declined / released / days_changed / moved,
crew_member_name, role, days, actor) written by the routes and the tracker's staffing writes
(one helper, `lib/staffingEvents.ts`). A Vercel cron (`/api/digest`, daily 23:30 UTC — Hobby
allows several daily crons) sends each PM one email per show with that day's unsent events,
each line carrying the booking's **current** status, then marks them sent. Nothing to
remember; nothing sent for a show whose ready email has not gone.

**Day-change flags** — Section B's `position_slot_flags`, surfaced on Edit Show (a rule under
the day grid: "3 bookings no longer match their days") and on the Needs-scheduling row.

**All-day extension on Add Day.** Add Day's dialog gains "Extend everyone on all-day positions
to this day" (ticked by default): for each `day_kind = 'all'` definition with a filled slot
on the previous day, book the same person into the new slot (a `timecards` row, status
`pencilled`) — the copy-crew behaviour Add Day has today, made explicit.

**Crew change notices** — offered, never automatic. After any action that changes a booked
person's days (a day removed, a slot released, a fill trimmed, a move), the actor is shown
"Tell the N crew whose days changed?" with the list; Yes sends each one their **new** day list
(`lib/daysChangedEmail.ts`, reusing the timesheet's day formatting). Also offered by Add Day
when all-day people were extended.

---

## Out of scope this round
Crew invites/logins UI (model exists); the per-person schedule grid (may return as the
scheduler's overview once C is felt); branding; the tracker, reports and Final Report
(unchanged); changing what a booking request email says beyond the day list it already
carries.

## Order, blast radius, proof
- **A** — one migration (dev → prod), a new component, readers updated. Proven by `schedule.mts`
  cases for label/tint/kind derivation and every reader rendering the same text as before for
  every legacy value. Dan tries the grid live on the preview.
- **B** — one migration (`position_defs`, `shows.pm_profile_id`, `show_assignments.source`,
  `sync_position_slots`, the flags view). Proven by `schedule.mts` (slot derivation across the
  8-day example: add a day, retag a day, remove a day — filled slots never vanish) and
  `rls.mts` (a PM named by the field sees the show; a scheduler does not see a show that
  has not been sent). Dan tries New Show live.
- **C** — one migration (`sent_to_scheduling_at`, `ready_email_sent_at`, `staffing_events`,
  the scheduler door). Emails proven with Resend's test mode on dev; the cron with a manual
  hit. Dan tries the whole flow on the preview with the seeded company.
Each ships to production on Dan's word, same procedure as always.
