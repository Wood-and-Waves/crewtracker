# CrewTracker speed assessment — 2026-10-04

Read-only. Nothing in this document has been changed in the code. Produced by 10 subsystem
readers, 36 adversarial skeptics (two per finding, prompted to refute), one synthesis — plus
live measurement of crewtracker.app from Dan's own Chrome session on his real show
(PwC Tax Assurance Oct'26: 8 days, 32 rooms, 76 timecards, 12 crew).

**Short version.** The database is not the problem — every query runs in 1–10 ms and the
RLS/index work from 0021–0023 is holding. The app is slow because it **waits in line**:
each page asks Supabase for things one after another when it could ask all at once, and
**nothing paints until the whole line has cleared**. One sequential round trip costs
~80–90 ms on the live site. A click between screens costs 550–900 ms; ~400 ms of that is
paid before the page does anything of its own. On top of that, every tracker load fires
~23 background server renders that help nothing.

---

## 1. Measured on the live site

All from Dan's laptop in Chrome, warm function, real show. "Server time" = time to last byte
of the HTML (Next streams the shell instantly, so first-byte is misleading).

| What | Measured | Note |
|---|---|---|
| **Fixed tax on any navigation** | **~400 ms** | Team page (one tiny query, 2 KB): 407 ms. Directory with 70 crew: 446 ms. |
| Click into a show (list → tracker) | 681 ms | 10 KB payload |
| Tracker → Scheduling | 565 ms | |
| Scheduling → Edit Show | **895 ms** | |
| Edit Show → Reports | 632 ms | |
| Reports → Tracker | 764 ms | |
| Settings | **862 ms** | six sequential waits for a trivial page |
| Tracker, hard load, desktop tree | 605–663 ms | 158 KB HTML decoded (14 KB gzipped), 868 KB JS decoded |
| Tracker, hard load, phone tree | 759–1072 ms | two samples, both slower than desktop; cause unverified |
| Crew clock link (public) | 350–500 ms | hours view 500–600 ms |
| **Cold start** (any of the above, first hit after idle) | **+1.0 to +1.4 s** | marketing page: 1.59 s then 0.23 s |
| One Supabase round trip (from Dallas) | 85–95 ms | auth health and PostgREST front door |
| **Background renders after one tracker load** | **23–24, ≈3.7 s server time** | every link prefetched, twice; ~100 function invocations in 4 min of browsing |

Functions run in `iad1` (Virginia); the database is in `us-east-2` (Ohio). No `regions` set in
`vercel.json`; the skeptics judged iad1 the best available on Hobby. There is **no
`loading.tsx` anywhere under `app/`** and **no `prefetch=` on any link** (both verified by
`find`/`grep`).

**Reconciliation with the agents.** They estimated 15–40 ms per sequential round trip from
the code. The live numbers say ~80–90 ms (Team ≈ 5 waves / 407 ms; Settings ≈ 6 waves /
862 ms; tracker ≈ 8 waves / 650–760 ms). Every "collapse the waves" item below is therefore
worth roughly double the agents' stated gain. Their wave counts are what matter; treat their
millisecond figures as a floor.

## 2. Where the time goes

A dashboard page load is a chain: the **proxy** validates the login with Supabase Auth (1
round trip) → the **layout** runs `getCurrentUser` (login validated *again*, then profile,
then membership — 3 in a row, because the membership query waits for
`active_organization_id`) plus a fourth read for the org switcher → the **page** runs its own
queries in dependent waves → render → hydrate. Every `router.refresh()` after a punch, a
fill or an Edit Show blur re-pays the layout chain and the page chain in full.

| Screen | Sequential waits today | Achievable | Where |
|---|---|---|---|
| Any dashboard page (layout alone) | 1 + 3 + 1 = 5 | 3 | `lib/session.ts:83,89,115,197` |
| Tracker | 1 + 3 + 4 = 8 | 5 | `shows/[id]/page.tsx:68` (isPmOnShow alone), `:109` rooms, `:138` timecards, `:170` punches |
| Reports | 1 + 3 + 5 = 9 | 4–5 | `reports/page.tsx:97,120,164,183` |
| Scheduling | 1 + 3 + 3–4 = 7–8 | 5 | `schedule/page.tsx:48,53,59,67` |
| Edit Show (reader claim, not skeptic-verified) | ~11 | ~4 | `shows/[id]/edit/page.tsx` |
| Fill picker open (browser → Supabase) | 5 waits, 9 requests | 1 wait, 4 requests | `FillPositionPicker.tsx:157–215` |
| Add crew modal open (browser → Supabase) | 5 waits | 1 wait | `StaffRoomModal.tsx:95–130` |
| Crew clock personal link (reader claim) | 4 | 2 | `lib/clockSession.ts` |
| Crew clock punch route (reader claim) | 8 | 3 | `app/api/clock/punch/route.ts` |

## 3. Ranked recommendations

Ordered by gain ÷ effort. None of the quick wins touches an RLS policy or needs a migration.

### Quick wins (an evening or less)

**Q1. Loading skeletons.** `app/dashboard/loading.tsx` and `app/dashboard/shows/[id]/loading.tsx`
— a Showbill ink band plus a few hairline rows. Click-to-first-feedback goes from the full
server render (550–900 ms measured) to one frame. Server time unchanged. Does not help the
very first entry into `/dashboard` (the layout's awaits sit above the boundary) and does not
help the tracker's day arrows (`?d=` is a search-param change on the same segment; a keyed
`<Suspense>` inside the page would be needed). Verify `redirect('/login')` and `notFound()`
still behave once streaming starts. **Effort: small. Largest perceived win available.**

**Q1b. Stop the prefetch storm** *(added from live measurement; not in the agents' plan).*
Each tracker load fires ~23 server renders — every nav link, ShowNav link and day arrow is
prefetched, twice. Because the routes are dynamic and have no loading boundary, those
prefetches carry nothing the click can use; the click still costs full price. Two shapes:
`prefetch={false}` on the high-fan-out links (AppShell nav, ShowNav, the tracker's day
arrows, the shows-list rows), or keep prefetch once Q1 exists (it then fetches the skeleton
shell, which is useful — but each prefetch still runs the layout's session chain
server-side). Recommend: Q1 first, re-measure the storm, then `prefetch={false}` on the
day arrows and nav at minimum. Effort: small, reversible one prop at a time.

**Q2. Tracker: fetch by `show_id` in the first wave.** `isPmOnShow` is awaited alone after the
first `Promise.all`; rooms filter by `work_day_id`; `fetchLiveTimecards` waits for rooms. All
three can go in wave 1 (`rooms.eq('show_id')`, `timecards.eq('show_id')` — indexed since
0023). Only punches need the active day. 4 page waves → 1. Agents: 45–120 ms; measured
per-wave cost says **~200–250 ms** per tracker load, day-arrow tap and post-punch refresh.
Give `fetchLiveTimecards` a by-show variant that keeps `.neq('booking_status','declined')`
and throw-on-error. Effort: small.

**Q3. Reports: one wave instead of five.** Rooms, timecards, punches, rates and clock_links
can all be fetched by `show_id` in the first batch; `isPmOnShow` needs only `id`. Also kills
the 400-UUID `.in()` URL lists. Agents: 50–200 ms; measured says ~300 ms+. Effort: small.

**Q4. Add crew modal: pass `showId`, one `Promise.all`.** `StaffRoomModal.tsx:95→107→117→126`
runs crew_members → rate cards → av_roles → a `work_days` lookup for a value the page already
has, strictly in series, in the BROWSER — so on venue wifi it is 5 phone round trips.
**0.4–0.8 s per open on site.** Both skeptics agreed. Effort: small. Risk: none.

**Q5. Fill picker: delete the repeat read.** `FillPositionPicker.tsx:213` re-fetches
`rooms.show_id` that `:159` already stored in state. One line; one browser round trip per
Open. The full fix is B1.

**Q6. Session: profile and memberships in parallel; switcher list from the same rows.**
`lib/session.ts:89` profiles → `:115` memberships (waits for `active_organization_id`) →
`:197` a second memberships read in `getMyOrganizations`, which awaits the cached
`getCurrentUser`, so the layout's `Promise.all` does not actually parallelise it. Fetch the
profile and ALL memberships (with `organizations(id, name, scheduling_enabled, disabled_at,
timecard_rounding_minutes)`) together, pick the active one in JS, derive the switcher from
the same rows; tracker and reports then lose their separate `organizations` query. Layout
chain 4 → 2 round trips on **every page and every refresh**; Settings 5 serial steps → 3.
Agents: 40–120 ms; measured says **~150–180 ms**. **Touches permission resolution** (not
RLS policies): keep the "live membership for that exact org" check and the `NO_PERMISSIONS`
default byte-identical; `rls.mts` must stay green. Effort: medium.

### Bigger items

**B1. Fill picker: stop asking the database what the page already knows.**
`FillPositionPicker.tsx:157–191` effect 1 looks up the slot's definition, the room's show, the
sibling slots and the held timecards (3 dependent waits); `:209–215` effect 2 waits on
`daysReady`, repeats the rooms read, then fires the 4 real queries. `ScheduleBoard` already
holds `showId`, `roomId` and every slot/booking/date. Pass them as props, delete effect 1.
5 waits / 9 requests → 1 wait / 4 requests: **240–400 ms per Open on desktop, 1–2 s on a
phone**, paid 20+ times per sheet. Effort: medium. Keep "booking a decliner is an UPDATE".

**B2. Scheduling page serial chain.** `schedule/page.tsx:48→53→59→67`; the middle three need
only `id`. 2–3 waves. Do while in the file for B1. Effort: medium.

**B3. Export PDF on the server.** `ExportPDFButton.tsx:58` runs `@react-pdf` layout on the
browser main thread: measured 1.2 s at 120 timecards, 3.2 s at 400, 2–4× slower on an iPad.
The Final Report route already renders the identical document with `renderToBuffer`; a
session-authenticated `GET /api/reports/pdf?showId=` makes the button a download link.
**Touches a financial boundary** — caller's session client, never admin. Effort: medium.

**B4. Readers flagged, not skeptic-verified — potentially the largest remaining:**
- Crew-clock **punch route is 8 sequential waits** (`app/api/clock/punch/route.ts`, the shows
  row read twice). 3 is achievable: 100–300 ms off the one tap a crew member is watching.
- Crew-clock loader is **4 waits, not the 3** CLAUDE.md records; `?v=hours` runs both loaders
  back to back (~7).
- **Edit Show is ~11 serial hops**, and every text-field blur is a write plus a full refresh
  (~19 requests each); each day-activity tap runs `sync_position_slots` (~87 RLS-checked
  statements, ~165 ms DB).
- **"Send email invites" posts one person at a time in series**: 0.7–1.2 s each, so 30 people
  is 20–35 s of blocked button.
- **Identify rate limit (20 per 10 min per IP)** will 429 a crew sharing one venue-wifi
  address at call time. Not a speed bug; a limit worth raising.
- **Silent 1000-row cap**: Reports' punch read, the shows-list staffing read and the queue
  are row-per-item with no pagination; above 1000 rows the numbers are *wrong*, not slow.
  Fix it in the by-`show_id` rewrites.

**Also noted (not in the agents' plan):** the marketing page `/` is fully dynamic
(`private, no-store`, auth-checked), so a stranger's first impression carries the full cold
start. Making it static and moving the logged-in redirect to the proxy removes that.

## 4. Contested (skeptics disagreed)

- `loading.tsx` helps the day arrows — no: search-param change on the same segment. Helps
  entry into a show, not stepping through its days.
- `isPmOnShow` returns every visible show id — real but ~5–9 ms; hoist it (Q2), don't write
  a boolean `is_pm_on_show()` migration.
- Conflict query downloads this show's own bookings (60 of 64 rows) — gzips to 2–4 KB, same
  `Promise.all`; fold into B1 only if free.
- Queue ships every slot to count them (45 KB for 5 shows) — ~30–50 ms; needs a SQL function
  plus migration; not worth it under ~10 sent shows.
- Shows list 225 KB nested JSON / `select('*')` / archived fetched whole — all parallel, so
  ~10–25 ms; the value is the 1000-row cap, not speed.
- CSV/PDF per-cell `Intl` formatters — 156 ms vs 2.8 ms in a micro-bench, ~83 ms at a realistic
  size, on an export click. Cheap cleanup if B3 happens.

## 5. Looked at and ruled out

RLS helper wrapping (65 of 67 policies hoisted; the two bare calls take a row column and
cannot be) · `show_id` denormalisation and index coverage (every hot filter column indexed;
single-table reads 0.3–1.7 ms) · `React.cache()` on the session (layout and page share one
chain) · proxy matcher (static assets, fonts, images excluded; public paths decided before
the auth call) · Vercel region (iad1 ↔ Ohio is the best Hobby offers) · fonts, ThemeScript,
root layout · `@react-pdf` and `qrcode` are NOT in the shared client bundle · tracker
single-tree cookie, punch paint-first, batch bulk writes, AnchoredPanel · `buildBoard()` is
0.15 ms for 90 slots · crew clock has no refresh after a punch · transaction pooler is
scripts-only (the app goes through PostgREST) · payroll loop is 16 ms at 120 cards · no
stray `force-dynamic`/`no-store` except the marketing `/`.

## 6. How to measure before and after

1. **Server time per screen** — Chrome console after a hard load:
   `performance.getEntriesByType('navigation')[0].responseEnd` (last byte, not first). Five
   samples, median, on `/dashboard`, a tracker, Reports, Scheduling, Settings. Q2/Q3/Q6 each
   move it by their wave count × ~85 ms.
2. **In-app click cost** — set `window.__t0=performance.now()` before the click, then read the
   `_rsc=` fetch's `duration` from `performance.getEntriesByType('resource')`. That is the
   550–900 ms figure above.
3. **The prefetch storm** — count `_rsc=` resource entries 6 s after a tracker load (23–24
   today) and `vercel logs --json` grouped by path (~100 invocations per 4 min today).
4. **Picker and modal opens** — DevTools Network filtered to `supabase.co`, click Open / Add
   crew: 9 requests in 5 steps / 5 in 5 today; target 4 in 1 / 5 in 1. Once on a phone.
5. **Database stays flat** — `npm run db:sql -- scripts/sql/checks/rls-cost.sql` before and
   after any query rewrite (by-`show_id` timecards 1.6 ms vs by-room-list 2.8 ms on dev).
   `npm test` after Q6.
6. **PDF (B3)** — `console.time` around Export PDF on the Meridian demo show on an iPad.

## 7. Dan's answers, and what is still open

Answered 2026-10-04: slow screens are the tracker on a phone, crew clock links, and the desk
screens (shows list / Reports / Edit Show) — not the Scheduling grid; the wait is *moving
between pages* and a general heaviness; measuring production was approved and done.

Still open: whether skeletons are wanted at all (some prefer the old screen staying put);
whether a migration is acceptable this round (nothing in the quick wins needs one); whether
Export PDF ever happens on an iPad (moves B3 up); how many crew have scanned one venue QR
inside ten minutes (the identify limit).

---

## Progress ledger (2026-10-04, Dan: "spend it")

Dan approved building items 1, 2, 4 and 5 now, as SEPARATE commits, on `scheduling` only —
nothing to `main` until he has seen the before/after numbers. Item 3 (session chain) is
deliberately parked for a fresh week and an undivided review.

**In flight:** workflow `wf_d87602de-f17` — five implementers in isolated worktrees, one
commit each, each reviewed by an independent Sonnet reviewer before merge:

| Key | Item | Model |
|---|---|---|
| A-skeletons-prefetch | loading.tsx ×2 + prefetch={false} on nav/day links | sonnet |
| B-tracker-by-show-id | tracker: isPmOnShow + rooms + timecards in wave 1 | sonnet |
| C-reports-by-show-id | Reports: one wave | sonnet |
| D-add-crew-modal | StaffRoomModal: showId prop, one Promise.all | sonnet |
| E-fill-picker | picker: siblings from board, one Promise.all, tests | opus |

**When it returns:** merge ONLY approved items into `scheduling`, in the order A → B → D
(D touches the same page.tsx as B — rebase D on B) → C → E. After EACH merge:
`npx tsc --noEmit`, `npm test`, `npm run build`. Then ONE push of `scheduling`, preview
deploys, measure the preview in Dan's Chrome against the baseline table above (same JS
snippets as section 6). Report the numbers; Dan decides on `main`.

**Baseline to beat (production, warm, Dan's laptop):** list→tracker 681 ms · tracker→
scheduling 565 · scheduling→edit 895 · edit→reports 632 · reports→tracker 764 · team
407 · settings 862 · background renders after a tracker load 23–24.

**Landed on `scheduling` (2026-10-04, all five reviewer-approved, tsc + 727 assertions + build green after each):**
ade46fb A skeletons + prefetch · a1ecf40 B tracker wave 1 · fcdf6cc D add-crew modal · 7a09de2 C reports one wave · 19f6591 E fill picker.
Pushed; preview building. NEXT: measure the preview against the baseline, then Dan decides on `main`.
Follow-ups noted by reviewers, none blocking: `currentWorkDayId` prop on StaffRoomModal is now unused; sub-routes under shows/[id] (edit/schedule/reports) borrow the tracker-shaped skeleton until they get their own; picker siblings come from the painted board, so a slot added by someone else appears on the next refresh rather than instantly.
**Follow-up landed (2026-10-04):** per-screen loading.tsx via components/PageSkeleton.tsx — React shows a fallback only for a NEWLY mounted boundary, so the parent skeleton never showed on tracker→edit (measured 1.8 s of old screen on the preview). 13 boundaries now. Preview measurement so far: background renders after a tracker hard load 23–24 → 0; list→tracker now served from prefetch with zero requests; the control page (Team, unchanged code) ran 530 ms on prod vs 698 on the preview in the same minute, i.e. the preview environment is ~30% slower, so raw preview ms understate the gain. NEXT: confirm the skeleton appears on tracker→edit, then Dan decides on main.
**Preview verified (ec6c524, 2026-10-04):** skeleton photographed on a child click (edit→reports, page landed 380 ms later); background renders after a tracker hard load 23–24 → 0; tracker→edit served from prefetch with zero requests. Per-click ms on the preview are NOT comparable to production (different database, smaller shows, and the unchanged control page swung 447–698 ms within one session), so the honest production before/after is: deploy to main, re-measure the same PwC show in the same minute. Awaiting Dan's decision on main. Nothing deployed.

## 8. Production before/after (2026-10-04, deployed as 74b687c)

Same show (PwC Tax Assurance Oct'26, 12 crew, 4 rooms), same laptop, warm function. Three
samples of the control page (Team, code unchanged) show the environment drifting slower
across the hour — 407 → 530 → 583 ms — so compare against the fresh baseline column and
read the gains as understated.

| Click | Baseline (1 h before) | Fresh baseline (25 min before) | After deploy | Changed this round? |
|---|---|---|---|---|
| Shows list, hard load | ~640 | 876 | **635** | prefetch storm removed |
| List → tracker | 681 | 661 | **instant, 0 requests** | skeleton + prefetch |
| Tracker → Scheduling | 565 | 729 | 803 | no (B2 parked) — skeleton now shows |
| Scheduling → Edit Show | 895 | 1,335 | 1,257 | no (B4 parked) — skeleton photographed |
| Edit Show → Reports | 632 | 731 | **494** | yes (C) |
| Reports → tracker | 764 | 734 | **561** | yes (B) |
| → Team (control) | 407 | 530 | 583 | no |
| Tracker, hard load | 605–663 | — | 645 | yes (B) — flat while the control slowed 40% |
| Background renders after a tracker load | 23–24 | 23 | **0** | yes (A) |

Proven and drift-immune: the storm is gone (23 → 0); a prefetched click is instant; a
non-prefetched click shows the outline at once (photographed on production, dark mode).
Drift-exposed but clear: Reports −32 % and the tracker −24 % on a day the control got
10 % slower. Not touched this round and still slow: Scheduling (B2) and Edit Show (B4),
which now at least answer the click with a skeleton. Next in line by gain ÷ effort:
item 3 (session chain, every page), then B4 Edit Show, then B2.
