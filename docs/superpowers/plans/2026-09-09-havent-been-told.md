# "Haven't been told" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Scheduling screen says whose days changed without anybody telling them, and gives one button to tell them and one to say they already know.

**Architecture:** Every staffing change already writes a row to `staffing_events`. That row gains a second stamp, `crew_told_at`, alongside the existing `sent_at` (which means "the PM saw it in the evening digest" — a different audience). A row with a notifiable `kind` and no `crew_told_at` is a person who has not been told. The Scheduling screen reads those rows, groups them by person, and offers the change notice that already exists. Nothing new is emailed and no new email is written.

**Tech Stack:** Next.js App Router (server page + one client component), Supabase/Postgres with RLS, the existing `/api/crew/days-changed` route, plain-Node tests in `scripts/test/schedule.mts`.

**Spec:** None written — designed with Dan in conversation on 2026-09-09. His decisions are recorded verbatim in Global Constraints below; treat that section as the spec.

## Global Constraints

- **"Any date change needs telling. Adding or subtracting."** (Dan, 2026-09-09.) So `moved`, `released`, `extended` and `days_changed` all count. `booked` does NOT — the booking request is how somebody is told they are on a show, and counting it would ask you to tell them twice. `accepted` and `declined` do not — those are the crew member's own answers, they already know.
- **There must be a way to clear it without emailing.** Sometimes you rang them. If the only way to clear the count is to send an email, the count gets ignored, and a counter everyone ignores is worse than no counter.
- **It is about the crew member, not the scheduler.** Two schedulers on one show share one list; either clearing it clears it for both.
- **It lives on the Scheduling screen**, in the strip above the grid, beside the counts. Dan: *"I imagine this will grow with some stats and todo's anyway."* Build it so a second line can sit beside it later.
- **Telling somebody is still OFFERED, never automatic.** The app's rule everywhere.
- **Nobody with no `crew_member_id` can be told** — a hand-typed name has no email. Those rows are skipped, not counted.
- **The existing change notice is the email.** `POST /api/crew/days-changed`, `lib/daysChangedEmail.ts`. Do not write a second one.
- Every RLS policy term that calls a helper is wrapped `(select fn())` — see CLAUDE.md. This plan adds no policy, but the rule holds if one is added.
- Migrations are forward-only, applied to dev first, then production; `npm run db:grants` immediately after any grant change.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/sql/migrations/0040_crew_told_at.sql` (create) | The column, its comment, the partial index, and the backfill that stops day one showing a year of history. No grant: `authenticated` holds a TABLE-level SELECT on `staffing_events`, which covers columns added later — unlike `timecards`, which is column-granted for the day_rate lockdown. |
| `lib/crewNotices.ts` (create) | The pure rule (which kinds need telling, grouped by person) plus the one query that reads them. No React, no email. |
| `components/CrewNoticesBar.tsx` (create) | The strip line: the count, "Tell them", "Mark as told". Client component, same confirm-bar shape as `CrewChangeNotice`. |
| `app/dashboard/shows/[id]/schedule/page.tsx` (modify) | Fetch the untold list alongside everything else and render the bar. |
| `app/api/crew/days-changed/route.ts` (modify) | Stamp `crew_told_at` when the notice actually sends; accept `markOnly` to stamp without sending. |
| `scripts/test/schedule.mts` (modify) | Tests for the pure rule. |
| `CLAUDE.md` (modify) | Record the column, the two stamps and why they are different. |

---

### Task 1: Migration 0040 — the second stamp

**Files:**
- Create: `scripts/sql/migrations/0040_crew_told_at.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `staffing_events.crew_told_at timestamptz` (nullable). Null = this change has not been passed on to the crew member.

- [ ] **Step 1: Write the migration**

```sql
-- Whose days changed without anybody telling them.
--
-- staffing_events already has `sent_at`, and it does NOT mean this: that stamp
-- is set by app/api/digest when the row appears in the PM's evening digest.
-- Telling the CREW MEMBER is a different act, a different audience and a
-- different day, so it gets its own stamp. Reusing sent_at would make the
-- digest silently mark people as told.
--
-- Dan, 2026-09-09: the prompt to tell somebody currently lives in the page you
-- happen to be on and dies when you navigate away, so a person's days can
-- change and nobody ever finds out that nobody told them.
--
-- WRITES EXISTING ROWS. Every event already in the table is backfilled as
-- told. Without that, the first time anybody opens the Scheduling screen they
-- meet a list of every change ever made — history nobody can act on, which
-- teaches them to ignore the number on day one.

alter table public.staffing_events
  add column if not exists crew_told_at timestamptz;

comment on column public.staffing_events.crew_told_at is
  'The crew member was told their days changed. Null = nobody has told them. NOT sent_at, which is the PM''s evening digest.';

-- The backfill: everything before this migration counts as told.
update public.staffing_events set crew_told_at = at where crew_told_at is null;

-- Read by the Scheduling screen for one show at a time, always filtered to the
-- untold rows. Partial, because the told rows are the overwhelming majority
-- and are never the ones being looked for.
create index if not exists staffing_events_untold_idx
  on public.staffing_events (show_id)
  where crew_told_at is null;
```

- [ ] **Step 2: Apply it to dev**

Run: `npm run db:migrate`
Expected: `0040_crew_told_at.sql` applied, `40 applied, 0 pending`.

- [ ] **Step 3: Verify the backfill left nothing untold**

Create `scripts/sql/checks/untold.sql`:

```sql
select count(*) as total,
       count(*) filter (where crew_told_at is null) as untold
from staffing_events;
```

Run: `npm run db:sql -- scripts/sql/checks/untold.sql`
Expected: `untold` is `0`. Any other number means the backfill did not run and the screen will open with a false backlog.

- [ ] **Step 4: Commit**

```bash
git add scripts/sql/migrations/0040_crew_told_at.sql scripts/sql/checks/untold.sql
git commit -m "0040: staffing_events.crew_told_at — whose days changed without being told."
```

---

### Task 2: The rule — which changes need telling, and who is owed one

**Files:**
- Create: `lib/crewNotices.ts`
- Test: `scripts/test/schedule.mts`

**Interfaces:**
- Consumes: nothing from Task 1 at compile time (the column is read in Task 3).
- Produces:
  - `NOTIFIABLE_KINDS: readonly StaffingEventKind[]`
  - `type UntoldRow = { id: string; kind: string; crew_member_id: string | null; crew_member_name: string; days: string | null }`
  - `type UntoldPerson = { crewMemberId: string; name: string; count: number }`
  - `summarizeUntold(rows: UntoldRow[]): UntoldPerson[]`

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test/schedule.mts`, immediately before the line `console.log('\n--- ready email: day compression ---')`:

```ts
console.log('\n--- who has not been told ---')
{
  const row = (kind: string, id: string | null, name: string): UntoldRow =>
    ({ id: `${kind}-${id ?? name}`, kind, crew_member_id: id, crew_member_name: name, days: null })

  // Any DATE change needs telling, added or subtracted (Dan, 2026-09-09).
  check('a move, a release, an extension and a day change all count',
    summarizeUntold([
      row('moved', 'a', 'Alex Reyes'),
      row('released', 'b', 'Bo Ellery'),
      row('extended', 'c', 'Casey Nguyen'),
      row('days_changed', 'd', 'Dana Okafor'),
    ]).length, 4)

  // Being booked is told by the booking request itself; an accept or a decline
  // is the crew member's own answer, so they already know.
  check('being booked is not something to tell them about',
    summarizeUntold([row('booked', 'a', 'Alex Reyes')]).length, 0)
  check('their own answers are not either',
    summarizeUntold([row('accepted', 'a', 'Alex Reyes'), row('declined', 'b', 'Bo Ellery')]).length, 0)

  // One person, three changes, is one person to tell — with the whole picture
  // in one email, not three.
  const many = summarizeUntold([
    row('moved', 'a', 'Alex Reyes'),
    row('released', 'a', 'Alex Reyes'),
    row('extended', 'a', 'Alex Reyes'),
  ])
  check('several changes to one person is one person', many.length, 1)
  check('and it says how many changes', many[0].count, 3)

  // A hand-typed name has no directory entry and therefore no email. Counting
  // them would show a number that no button can ever clear.
  check('somebody with no directory entry is not counted',
    summarizeUntold([row('moved', null, 'Somebody Typed In')]).length, 0)

  // Stable order, so the bar does not reshuffle between loads.
  check('people come back in name order',
    summarizeUntold([row('moved', 'c', 'Casey Nguyen'), row('moved', 'a', 'Alex Reyes')])
      .map(p => p.name), ['Alex Reyes', 'Casey Nguyen'])
}
```

Add the import beside the other lib imports at the top of the file:

```ts
import { summarizeUntold, type UntoldRow } from '../../lib/crewNotices.ts'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:schedule`
Expected: FAIL — `Cannot find module '../../lib/crewNotices.ts'`.

- [ ] **Step 3: Write the module**

Create `lib/crewNotices.ts`:

```ts
// Whose days changed without anybody telling them.
//
// The prompt to tell somebody lives in the confirm bar that appears right
// after a change, and it dies when the scheduler navigates away — so until
// 2026-09-09 a person's days could change and nothing anywhere recorded that
// nobody had passed it on. staffing_events.crew_told_at (migration 0040) is
// that record; this module is the rule for reading it.
//
// Plain module, no 'use client': the Scheduling page (a Server Component)
// imports the query, and the pure half is unit-tested.

import type { StaffingEventKind } from '@/lib/staffingEvents'

/**
 * The changes a crew member needs telling about.
 *
 * Dan, 2026-09-09: "Any date change needs telling. Adding or subtracting."
 *
 * Deliberately NOT here: `booked`, because the booking request is how somebody
 * is told they are on a show at all — counting it would ask you to tell them
 * twice — and `accepted` / `declined`, which are the crew member's own answers.
 */
export const NOTIFIABLE_KINDS: readonly StaffingEventKind[] = [
  'moved', 'released', 'extended', 'days_changed',
]

/** One untold staffing event, as read from the database. */
export type UntoldRow = {
  id: string
  kind: string
  crew_member_id: string | null
  crew_member_name: string
  days: string | null
}

/** One person owed a word, and how many changes are behind it. */
export type UntoldPerson = { crewMemberId: string; name: string; count: number }

/**
 * The people, not the events. Somebody moved three times is one person to
 * tell, and the notice they get lists their whole revised schedule anyway.
 *
 * A row with no crew_member_id is dropped: a hand-typed name has no directory
 * entry and therefore no email address, so it would be a number no button
 * could ever clear.
 */
export function summarizeUntold(rows: UntoldRow[]): UntoldPerson[] {
  const byPerson = new Map<string, UntoldPerson>()
  for (const r of rows) {
    if (!r.crew_member_id) continue
    if (!(NOTIFIABLE_KINDS as readonly string[]).includes(r.kind)) continue
    const person = byPerson.get(r.crew_member_id)
      ?? { crewMemberId: r.crew_member_id, name: r.crew_member_name, count: 0 }
    person.count++
    byPerson.set(r.crew_member_id, person)
  }
  return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:schedule`
Expected: PASS, 6 more assertions than before.

- [ ] **Step 5: Commit**

```bash
git add lib/crewNotices.ts scripts/test/schedule.mts
git commit -m "The rule for who has not been told: any date change, grouped by person."
```

---

### Task 3: Read the untold rows, and show them on the Scheduling screen

**Files:**
- Modify: `lib/crewNotices.ts` (add the query)
- Create: `components/CrewNoticesBar.tsx`
- Modify: `app/dashboard/shows/[id]/schedule/page.tsx`

**Interfaces:**
- Consumes: `summarizeUntold`, `UntoldRow`, `UntoldPerson`, `NOTIFIABLE_KINDS` from Task 2; `crew_told_at` from Task 1.
- Produces:
  - `fetchUntold(supabase: SupabaseLike, showId: string): Promise<UntoldPerson[]>`
  - `<CrewNoticesBar showId={string} people={UntoldPerson[]} />`

- [ ] **Step 1: Add the query to `lib/crewNotices.ts`**

Append:

```ts
/** Just enough of a Supabase client to read a table — see lib/staffingEvents.ts
 *  for why this is structural rather than pinned to one client type. */
type SupabaseLike = { from: (table: string) => any }

/**
 * The people owed a word on this show.
 *
 * SCOPING IS RLS: staffing_events' SELECT policy is "the show is one you can
 * see", so a scheduler's own session returns only shows they are entitled to
 * and there is nothing extra to check here.
 */
export async function fetchUntold(supabase: SupabaseLike, showId: string): Promise<UntoldPerson[]> {
  const { data } = await supabase
    .from('staffing_events')
    .select('id, kind, crew_member_id, crew_member_name, days')
    .eq('show_id', showId)
    .is('crew_told_at', null)
    .in('kind', NOTIFIABLE_KINDS as unknown as string[])
  return summarizeUntold((data ?? []) as UntoldRow[])
}
```

- [ ] **Step 2: Write the bar**

Create `components/CrewNoticesBar.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import type { UntoldPerson } from '@/lib/crewNotices'

// "2 people's days changed and haven't been told."
//
// The confirm bar after a change is a prompt that dies when you navigate away;
// this is the standing record of the same thing. Same shape as
// CrewChangeNotice — a 3px accent rule, not a dialog — because it is a
// suggestion, not something blocking the screen.
//
// TWO BUTTONS, and the second one is the important one (Dan, 2026-09-09): if
// the only way to clear the count is to send an email, people send unwanted
// emails or learn to ignore the number, and a counter everyone ignores is
// worse than no counter. "Already told them" clears it without sending.

export default function CrewNoticesBar({ showId, people }: { showId: string; people: UntoldPerson[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  if (people.length === 0) return null

  async function post(markOnly: boolean) {
    setBusy(true)
    setError('')
    const res = await fetch('/api/crew/days-changed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, crewMemberIds: people.map(p => p.crewMemberId), markOnly }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(body.error || 'That did not work.'); return }
    setDone(markOnly ? 'Marked as told.' : `Told ${body.sent ?? 0}.`)
    router.refresh()
  }

  const names = people.map(p => p.name).join(', ')

  return (
    <div className="border-l-[3px] border-accent py-1 pl-3">
      <p className="text-sm text-ink">
        <strong>{people.length}</strong>{' '}
        {people.length === 1 ? "person's days have" : "people's days have"} changed and{' '}
        {people.length === 1 ? 'they have' : 'they have'} not been told.
      </p>
      <p className="mt-0.5 text-xs text-muted">{names}</p>
      {done ? (
        <p className="mt-1 text-xs text-muted">{done}</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => post(false)}>
            {busy ? 'Sending…' : 'Tell them'}
          </Button>
          <button
            type="button"
            className="text-xs text-muted underline hover:text-ink disabled:opacity-40"
            disabled={busy}
            onClick={() => post(true)}
          >
            Already told them
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Render it on the Scheduling screen**

In `app/dashboard/shows/[id]/schedule/page.tsx`, add the imports beside the others:

```tsx
import CrewNoticesBar from '@/components/CrewNoticesBar'
import { fetchUntold } from '@/lib/crewNotices'
```

Add the read to the page's one round of queries. The destructuring at
`app/dashboard/shows/[id]/schedule/page.tsx:58` currently reads:

```tsx
  const [
    { data: slotRows }, { data: bookingRows }, { data: flagRows }, { data: defRows }, { data: roleRows }, { data: pmProfile },
  ] = await Promise.all([
```

Make it:

```tsx
  const [
    { data: slotRows }, { data: bookingRows }, { data: flagRows }, { data: defRows }, { data: roleRows }, { data: pmProfile },
    untold,
  ] = await Promise.all([
```

and add this as the LAST entry of that array, after the `pmProfile` ternary —
the order of the array must match the order of the destructuring or every
variable silently holds the wrong query's result:

```tsx
    fetchUntold(supabase, id),
```

Note it is `untold`, not `{ data: untold }`: `fetchUntold` returns the finished
list, not a Supabase response.

Then, immediately AFTER the closing `</div>` of the strip's right-hand cluster (the `<div className="ml-auto flex flex-wrap items-center gap-3">` block) and before the grid, render:

```tsx
      {untold.length > 0 && (
        <div className="mb-4">
          <CrewNoticesBar showId={id} people={untold} />
        </div>
      )}
```

- [ ] **Step 4: Verify it compiles and the page still renders**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run build`
Expected: `BUILD EXIT: 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/crewNotices.ts components/CrewNoticesBar.tsx "app/dashboard/shows/[id]/schedule/page.tsx"
git commit -m "The Scheduling screen says whose days changed without anybody telling them."
```

---

### Task 4: Stamp the events — on send, and on "already told them"

**Files:**
- Modify: `app/api/crew/days-changed/route.ts`

**Interfaces:**
- Consumes: `NOTIFIABLE_KINDS` from Task 2, `crew_told_at` from Task 1.
- Produces: `POST /api/crew/days-changed { showId, crewMemberIds, markOnly?: boolean }` → `{ ok, sent, skipped, marked }`.

- [ ] **Step 1: Accept `markOnly` and stamp on success**

In `app/api/crew/days-changed/route.ts`, add the import:

```ts
import { NOTIFIABLE_KINDS } from '@/lib/crewNotices'
```

Change the body parse to accept the flag:

```ts
  let showId: string | undefined
  let crewMemberIds: string[] | undefined
  let markOnly: boolean | undefined
  try {
    ({ showId, crewMemberIds, markOnly } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
```

Add this helper just above the `for (const c of crew)` loop:

```ts
  // The events for one person on this show that nobody has passed on. Stamped
  // through the service role for the same reason the token upsert is: the app
  // never writes staffing_events from a browser, and the only UPDATE anybody
  // has ever done here is the digest's own sent_at. Who may do this was
  // decided above, under the caller's session.
  let marked = 0
  async function markTold(crewMemberId: string) {
    const { data } = await admin
      .from('staffing_events')
      .update({ crew_told_at: new Date().toISOString() })
      .eq('show_id', showId)
      .eq('crew_member_id', crewMemberId)
      .is('crew_told_at', null)
      .in('kind', NOTIFIABLE_KINDS as unknown as string[])
      .select('id')
    marked += data?.length ?? 0
  }
```

Inside the loop, before the email is built, short-circuit when only marking:

```ts
    // "Already told them" — they rang, or it was said in the room. Clearing
    // without sending is the whole reason this is a count and not a nag
    // (Dan, 2026-09-09).
    if (markOnly) {
      await markTold(c.id)
      continue
    }
```

And after a successful send, stamp:

```ts
    if (result.error) { skipped.push(c.full_name); continue }
    await markTold(c.id)
    sent++
```

Finally return the count:

```ts
  return NextResponse.json({ ok: true, sent, skipped, marked })
```

- [ ] **Step 2: Verify the email path still requires an address, and the mark path does not**

`markOnly` must run BEFORE the `if (!c.email)` skip, so somebody with no email address on file can still be cleared from the list — otherwise they sit there forever with no button that works. Move the `markOnly` block above that check and confirm by reading the file.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Prove it end to end on dev**

Start the dev server (`preview_start` with `crewtracker-dev`), sign in with `/api/dev/login?secret=…&next=/dashboard/schedule`, open a sent show's Scheduling screen, use a position flag's **Move** to move somebody to another day, then reload the Scheduling screen.

Expected: the bar appears reading "1 person's days have changed and they have not been told", naming them.

Press **Already told them**. Expected: the bar disappears, and this returns 0:

```sql
select count(*) from staffing_events where crew_told_at is null;
```

- [ ] **Step 5: Commit**

```bash
git add app/api/crew/days-changed/route.ts
git commit -m "Telling somebody, or saying they already know, clears them from the list."
```

---

### Task 5: Write it down

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Record the column and the two stamps**

In the piece-C section, under the `staffing_events` paragraph, add:

```markdown
**`staffing_events` carries TWO stamps and they are not interchangeable.**
`sent_at` means the row appeared in the PM's evening digest; `crew_told_at`
(0040) means somebody passed the change on to the crew member. Different
audience, different day. The Scheduling screen reads the second one: any row
with a notifiable kind (`moved`, `released`, `extended`, `days_changed` — any
date change, added or subtracted) and no `crew_told_at` is a person nobody has
told, listed in `CrewNoticesBar` above the grid with **Tell them** and
**Already told them**. The second button is not a convenience: if the only way
to clear the count is to send an email, people send unwanted emails or learn to
ignore the number. `booked` is deliberately not notifiable — the booking
request is how somebody is told they are on a show — and neither are `accepted`
or `declined`, which are the crew member's own answers.
```

In the migrations list, add:

```markdown
                       · 0040 staffing_events.crew_told_at: whose days changed
                       without the crew being told, read by the Scheduling
                       screen. WRITES EXISTING ROWS (backfills every existing
                       event as told, so the screen does not open on a year of
                       history nobody can act on).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: the two staffing_events stamps, and what makes a change notifiable."
```

---

## Verification (end to end)

- `npm test` — the four suites, with 6 new assertions in `schedule.mts`.
- `npm run build` — exit 0.
- On dev, in the browser: move somebody → the bar appears → **Tell them** sends the change notice (check `DEV_EMAIL_TO`) and the bar clears; move somebody else → **Already told them** clears it with no email.
- `select count(*) from staffing_events where crew_told_at is null;` returns 0 after both.
- A person with no email on file can still be cleared with **Already told them**.

## Blast radius, per step

Tasks 2–5 are code on `scheduling` — preview only until merged. Task 1 is a **migration that writes existing rows**: dev first, verify the backfill, let the preview exercise it, then on the day it ships — `npm run db:dump` → `npm run db:migrate -- --prod` → `npm run db:grants` → `npm run db:schema` → commit both generated files → merge `scheduling` → `main`. Production verification is reads only: real crew are on that database and every scheduling button sends real email.
