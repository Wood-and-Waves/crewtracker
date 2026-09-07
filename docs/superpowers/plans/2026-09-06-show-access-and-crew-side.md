# Show access & crew-side logins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sections 1, 2, 3 and 5 of `docs/superpowers/specs/2026-09-06-show-access-and-schedule-design.md` — a login is linked to its directory entry by email, a staffed person sees only their own rows on that show and punches them from the crew screen, a PM-side person sees everything, and only admins or the show's PM can unlock a finalized show. Invisible to every existing user until a link exists.

**Architecture:** Three migrations (0028 link, 0029 visibility, 0030 unlock guard) each proven by real signed-in checks in `scripts/test/rls.mts` before any app code depends on them. The crew screen is the existing `/clock` page reused: its rules move into `lib/clockPunch.ts` so the token route and the new session route cannot drift. The tracker page branches PM-side / crew-side on one RPC.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres 17, RLS, plpgsql triggers), TypeScript, the repo's plain-Node test runner (`npm test`), `npm run db:migrate` / `db:sql` / `db:grants` / `db:schema`.

## Global Constraints

- **Every RLS helper call is wrapped `(select fn())`; set-returning helpers are used as `in (select fn())`** — never a bare call in a policy (CLAUDE.md, the 0021 incident).
- **No two tables' policies may reference each other, even via a function** — `shows` must never read `timecards`; use the bookkeeping table (CLAUDE.md, the recursion incident).
- **Never `select('*')` on a service-role path** — explicit column lists only (`lib/clockSession.ts` header).
- **Every write from the browser is verified** (`.select('id')` + row count) — an UPDATE matching no policy returns success with zero rows.
- **`db:sql` bypasses RLS** — only `rls.mts` (real `set local role authenticated` sessions) proves a policy.
- **Migrations: dev first → `npm run test:rls` green → `scripts/sql/checks/rls-cost.sql` → production only on Dan's word** (backup → `--prod` → `db:grants` → `db:schema` → merge). Say the blast radius in the same sentence as any commit/push.
- **Commit messages:** one clear line, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work on `scheduling` (preview only); `main` deploys.
- Copy is plain English; the word for a list of roles is **position**, never "call".
- `npm run build` before a task is called done; `rm -rf .next` after a build if the dev server was running.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/sql/migrations/0028_crew_member_login_link.sql` | `crew_members.profile_id`, unique index, `link_crew_member_by_email()` trigger functions, backfill |
| `scripts/sql/migrations/0029_show_crew_access.sql` | `show_crew_access` table + maintaining triggers + policy; `my_pm_show_ids()`, `my_crew_member_ids()`, real `is_own_timecard()`; shows/timecards/punches policies; `crew` base_role |
| `scripts/sql/migrations/0030_unlock_guard.sql` | `guard_show_unlock()` trigger on `shows.finalized_at` |
| `scripts/test/rls.mts` | fixtures `sam`, `samCrew`; checks 1–11 from the spec |
| `lib/permissions.ts` | `Role` gains `'crew'`; `PERMISSION_PRESETS.crew` |
| `app/dashboard/directory/[crewId]/page.tsx`, `components/EditCrewMemberClient.tsx` | the Login row: linked email, Unlink, shared-email note |
| `lib/clockPunch.ts` (new) | every rule of a crew punch, shared by both routes: `applyCrewPunch()` |
| `app/api/clock/punch/route.ts` | token route → resolves link, calls `applyCrewPunch` |
| `app/api/clock/punch-me/route.ts` (new) | session route → resolves the caller's crew_member on the show, calls `applyCrewPunch` |
| `lib/clockSession.ts` | `loadClockViewForProfile(showId, profileId, requestedDate?)` sharing the day/room/punch assembly with `loadClockView` |
| `app/clock/[token]/ClockPunch.tsx` | prop `endpoint` (`'/api/clock/punch'` default) and `credential` (`{ token }` or `{}`) |
| `components/CrewShowScreen.tsx` (new) | server component: renders `ClockPunch` for a crew-side viewer of a show |
| `app/dashboard/shows/[id]/page.tsx` | PM-side → tracker; crew-side → `CrewShowScreen`; passes `canUnlock` |
| `app/dashboard/shows/[id]/reports/page.tsx`, `.../edit/page.tsx`, `.../clock/print/page.tsx` | crew-side → `redirect()` to the show |
| `components/UnlockShowButton.tsx` | copy only |
| `CLAUDE.md` | the model, the rules, the migrations list |

---

### Task 1: Migration 0028 — the login ↔ directory link

**Files:**
- Create: `scripts/sql/migrations/0028_crew_member_login_link.sql`
- Modify: `scripts/test/rls.mts` (fixtures after `dave`, checks before `=== removed and misdirected users get nothing ===`)

**Interfaces:**
- Produces: `crew_members.profile_id uuid null`; SQL function `public.relink_crew_member(p_crew_member_id uuid) returns uuid` (the profile it linked, or null); triggers `crew_members_link_login` (AFTER INSERT OR UPDATE OF email ON crew_members) and `memberships_link_crew` (AFTER INSERT ON memberships).

- [ ] **Step 1: Write the failing checks** — append to `scripts/test/rls.mts` right after the `dave` fixture block (after `await q(\`insert into show_assignments (show_id, profile_id) values ($1,$2)\`, [showA.id, dave])`):

```ts
// ---- Section 1 fixtures: a login that IS a directory entry (0028) ----
// sam has a login in org A (crew preset: nothing) and a directory entry in A
// with the same email, so the link is made automatically. A second directory
// entry in org B with the SAME email must stay unlinked: links never cross
// companies.
const samEmail = `${TAG}-sam@example.test`
const [samCrewA] = await q(`insert into crew_members (organization_id, full_name, email) values ($1,'Sam Crew',$2) returning id`, [orgA, samEmail.toUpperCase()])
const [samCrewB] = await q(`insert into crew_members (organization_id, full_name, email) values ($1,'Sam In B',$2) returning id`, [orgB, samEmail])
const sam = await makeUser(samEmail)
await q(`insert into memberships (profile_id, organization_id, base_role) values ($1,$2,'crew')`, [sam, orgA])
await q(`update profiles set active_organization_id=$2 where id=$1`, [sam, orgA])
```

and this block before `console.log('\n=== removed and misdirected users get nothing ===')`:

```ts
  console.log('\n=== a login links to its directory entry by email (0028) ===')
  {
    const [a] = await q(`select profile_id from crew_members where id=$1`, [samCrewA.id])
    check('joining a company links the one directory entry with that email (case-insensitive)', a.profile_id === sam, `${a.profile_id}`)
    const [b] = await q(`select profile_id from crew_members where id=$1`, [samCrewB.id])
    check('and never a directory entry in another company', b.profile_id === null, `${b.profile_id}`)

    // Two entries sharing an email: neither is linked, and the existing link is
    // NOT disturbed by a newcomer.
    const [dup] = await q(`insert into crew_members (organization_id, full_name, email) values ($1,'Sam Twin',$2) returning id`, [orgA, samEmail])
    const [twin] = await q(`select profile_id from crew_members where id=$1`, [dup.id])
    const [still] = await q(`select profile_id from crew_members where id=$1`, [samCrewA.id])
    check('a second entry with the same email is not linked', twin.profile_id === null, `${twin.profile_id}`)
    check('and the first keeps its link', still.profile_id === sam, `${still.profile_id}`)
    await q(`delete from crew_members where id=$1`, [dup.id])

    // Changing the email away from the login clears the link; changing it back relinks.
    await q(`update crew_members set email='nobody@example.test' where id=$1`, [samCrewA.id])
    const [cleared] = await q(`select profile_id from crew_members where id=$1`, [samCrewA.id])
    check('an email that no longer matches clears the link', cleared.profile_id === null, `${cleared.profile_id}`)
    await q(`update crew_members set email=$2 where id=$1`, [samCrewA.id, samEmail])
    const [back] = await q(`select profile_id from crew_members where id=$1`, [samCrewA.id])
    check('and matching again relinks', back.profile_id === sam, `${back.profile_id}`)

    // The app's explicit relink for a row the triggers could not decide.
    await q(`update crew_members set profile_id=null where id=$1`, [samCrewA.id])
    const [r] = await q(`select relink_crew_member($1) as p`, [samCrewA.id])
    check('relink_crew_member() links an unlinked entry', r.p === sam, `${r.p}`)
  }
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls 2>&1 | grep -E "0028|✗|passed|failed"`
Expected: the fixture insert fails with `column "email"…` no — email exists; it fails at `select profile_id` with `column "profile_id" does not exist` (exit 1). If `base_role='crew'` is refused by a check constraint, note the constraint name for Step 3.

- [ ] **Step 3: Write the migration**

```sql
-- A directory entry learns which login it is (Section 1 of the 2026-09-06 spec).
--
-- Dan: "email is what will drive the crew logon." So the link is made by EMAIL,
-- automatically, with two guard rails: only inside ONE organization (Company
-- B's entry for the same person links only to that person's membership in B;
-- nothing ever matches across companies — the cross-org rule in CLAUDE.md),
-- and only when exactly ONE directory entry in the company carries the email.
-- Zero or several → no link, and the page says why.
--
-- Nothing reads profile_id until 0029. With no links, nothing changes.

alter table public.crew_members
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

-- One directory entry per login per company.
create unique index if not exists crew_members_org_profile_uniq
  on public.crew_members (organization_id, profile_id) where profile_id is not null;

-- The one rule, in one place. Returns the profile linked (or null). SECURITY
-- DEFINER: it reads profiles/memberships across the organization, which the
-- caller may not be allowed to see directly. search_path pinned.
create or replace function public.relink_crew_member(p_crew_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_email text;
  v_profile uuid;
  v_twins integer;
begin
  select organization_id, lower(trim(email)) into v_org, v_email
  from crew_members where id = p_crew_member_id;
  if v_org is null then return null; end if;

  if v_email is null or v_email = '' then
    update crew_members set profile_id = null where id = p_crew_member_id and profile_id is not null;
    return null;
  end if;

  -- Exactly one directory entry in this company with this email, or nothing.
  select count(*) into v_twins from crew_members
  where organization_id = v_org and lower(trim(email)) = v_email;
  if v_twins <> 1 then
    update crew_members set profile_id = null where id = p_crew_member_id and profile_id is not null;
    return null;
  end if;

  -- Exactly one live member of this company with this email, or nothing.
  select p.id into v_profile
  from memberships m join profiles p on p.id = m.profile_id
  where m.organization_id = v_org and m.deactivated_at is null
    and lower(trim(p.email)) = v_email
  limit 2;
  if (select count(*) from memberships m join profiles p on p.id = m.profile_id
      where m.organization_id = v_org and m.deactivated_at is null
        and lower(trim(p.email)) = v_email) <> 1 then
    v_profile := null;
  end if;

  update crew_members set profile_id = v_profile
  where id = p_crew_member_id and profile_id is distinct from v_profile;
  return v_profile;
end;
$$;
revoke execute on function public.relink_crew_member(uuid) from public, anon;
grant execute on function public.relink_crew_member(uuid) to authenticated, service_role;

-- Directory side: a new entry, or an email change.
create or replace function public.crew_members_link_login_tg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  perform relink_crew_member(new.id);
  -- An email change can also free a twin that was blocked by this row.
  if tg_op = 'UPDATE' and old.email is distinct from new.email and old.email is not null then
    for v_id in select id from crew_members
      where organization_id = new.organization_id and id <> new.id
        and lower(trim(email)) = lower(trim(old.email)) loop
      perform relink_crew_member(v_id);
    end loop;
  end if;
  return null;
end; $$;
drop trigger if exists crew_members_link_login on public.crew_members;
create trigger crew_members_link_login
  after insert or update of email on public.crew_members
  for each row execute function public.crew_members_link_login_tg();

-- Login side: somebody joins (or is reactivated in) a company.
create or replace function public.memberships_link_crew_tg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_email text; v_id uuid;
begin
  select lower(trim(email)) into v_email from profiles where id = new.profile_id;
  if v_email is null then return null; end if;
  for v_id in select id from crew_members
    where organization_id = new.organization_id and lower(trim(email)) = v_email loop
    perform relink_crew_member(v_id);
  end loop;
  return null;
end; $$;
drop trigger if exists memberships_link_crew on public.memberships;
create trigger memberships_link_crew
  after insert or update of deactivated_at on public.memberships
  for each row execute function public.memberships_link_crew_tg();

-- The crew role preset (Section 2) — memberships.base_role has no check
-- constraint today (verified on dev 2026-09-06); nothing to widen. If one is
-- ever added it must include 'crew'.

-- Backfill: every existing entry with an email, same rule.
do $$
declare r record;
begin
  for r in select id from crew_members where email is not null loop
    perform relink_crew_member(r.id);
  end loop;
end $$;

-- Column grant: crew_members is table-granted, so nothing to add. The app
-- writes profile_id only to NULL (Unlink); the triggers own every other value.
```

- [ ] **Step 4: Apply on dev and run the checks**

Run: `npm run db:migrate 2>&1 | tail -3 && npm run test:rls 2>&1 | grep -E "0028|✗|passed|failed"`
Expected: `0028_crew_member_login_link.sql … ok`; the six new checks ✓; `64 passed, 0 failed` (58 + 6).

- [ ] **Step 5: Commit** — to `scheduling` (preview only; dev migrated; production untouched)

```bash
git add scripts/sql/migrations/0028_crew_member_login_link.sql scripts/test/rls.mts
git commit -m "Migration 0028: a directory entry links to its login by email, inside one company only (Section 1).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 2: The Login row on Edit Crew

**Files:**
- Modify: `app/dashboard/directory/[crewId]/page.tsx`
- Modify: `components/EditCrewMemberClient.tsx`

**Interfaces:**
- Consumes: `crew_members.profile_id` (Task 1).
- Produces: `EditCrewMemberClient` props `login: { email: string | null } | null`, `emailSharedBy: number`.

- [ ] **Step 1: Page — read the link and the twin count.** In `app/dashboard/directory/[crewId]/page.tsx`, replace the `Promise.all` with:

```ts
  const [{ data: crewRow }, { data: visibleRates }] = await Promise.all([
    supabase
      .from('crew_members')
      // profiles(email): the linked login, if any. Readable because the
      // profiles policy shows every member of the caller's organization.
      .select('*, rate_cards(id, role), profiles(email)')
      .eq('id', crewId)
      .single(),
    supabase.from('crew_rate_cards_visible').select('id, day_rate').eq('crew_member_id', crewId),
  ])

  if (!crewRow) notFound()

  // How many directory entries in this company share the email. Two or more
  // means no login can be linked, and the page says so instead of showing an
  // empty "No login" that looks like a bug.
  const email = ((crewRow as any).email as string | null)?.trim().toLowerCase()
  const { count: emailSharedBy } = email
    ? await supabase.from('crew_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', user.organizationId!)
        .ilike('email', email)
    : { count: 0 }
```

and pass to the client:

```tsx
    <EditCrewMemberClient
      crew={crew}
      availableRoles={roles || []}
      shoulderSurferMode={user?.shoulderSurfer ?? false}
      canViewRates={user?.can('can_view_pay_rates') ?? false}
      canEditRates={user?.can('can_edit_pay_rates') ?? false}
      login={(crewRow as any).profiles ? { email: (crewRow as any).profiles.email ?? null } : null}
      emailSharedBy={emailSharedBy ?? 0}
    />
```

- [ ] **Step 2: Client — the row.** In `components/EditCrewMemberClient.tsx` add to the props type and destructuring:

```ts
  login = null,
  emailSharedBy = 0,
}: {
  ...
  /** The CrewTracker login this entry is linked to (0028), matched by email. */
  login?: { email: string | null } | null
  /** Directory entries in this company sharing this email; 2+ blocks linking. */
  emailSharedBy?: number
```

Add state and the unlink handler next to `saveField`:

```ts
  const [linked, setLinked] = useState(login)
  const [linkError, setLinkError] = useState('')

  // The app only ever writes profile_id to NULL. Every other value is set by
  // the database from the email (migration 0028), so a wrong link is fixed by
  // fixing the email, and an unwanted one by this button.
  async function unlinkLogin() {
    if (!confirm('Unlink this login? They will lose access to shows they are staffed on until the emails match again.')) return
    setLinkError('')
    const { data, error } = await supabase
      .from('crew_members').update({ profile_id: null }).eq('id', crew.id).select('id')
    if (error || !data || data.length === 0) {
      setLinkError(error?.message ?? 'That did not save — you may not have permission to edit the directory.')
      return
    }
    setLinked(null)
    router.refresh()
  }
```

Render, as a ruled row directly under the Email field (find the email `<input>` and add after its wrapping row):

```tsx
        {/* Login — which CrewTracker account this person is. Matched by email
            automatically (0028); shown so a wrong match is visible and a click
            away from undone. */}
        <div className="flex items-center justify-between border-b border-line py-2.5">
          <span className="text-sm text-ink">Login</span>
          {linked ? (
            <span className="flex items-center gap-2 text-sm text-ink">
              {linked.email}
              <button type="button" onClick={unlinkLogin} aria-label="Unlink login"
                className="rounded-pill border border-line px-2 py-0.5 text-xs text-muted hover:text-danger">✕ Unlink</button>
            </span>
          ) : emailSharedBy >= 2 ? (
            <span className="text-xs text-muted">Two people in the directory share this email, so no login is linked. Fix the emails to link one.</span>
          ) : (
            <span className="text-sm text-muted">No login</span>
          )}
        </div>
        {linkError && <p className="text-xs text-danger">{linkError}</p>}
```

- [ ] **Step 3: Type-check and look at it**

Run: `npx tsc --noEmit && echo ok`
Then start dev (`preview_start crewtracker-dev`), open `/dashboard/directory/<any crew id>` in the signed-in pane, confirm the row reads "No login"; run on dev `update profiles set email=(select email from crew_members where id='<that id>') where id=(select profile_id from memberships limit 1)` is NOT needed — instead set a directory entry's email to your own dev login's email via the page's Email field, reload, and confirm the row shows that email with ✕ Unlink; click Unlink, confirm it reads "No login"; set the email back to what it was.

- [ ] **Step 4: Build and commit** (stop dev first; `rm -rf .next` after)

```bash
npm run build && rm -rf .next
git add app/dashboard/directory/[crewId]/page.tsx components/EditCrewMemberClient.tsx
git commit -m "Edit Crew shows the linked login, with Unlink, and explains a shared email.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 3: Migration 0029 — who sees what on a show

**Files:**
- Create: `scripts/sql/migrations/0029_show_crew_access.sql`
- Modify: `scripts/test/rls.mts`
- Modify: `lib/permissions.ts`

**Interfaces:**
- Consumes: `crew_members.profile_id` (Task 1).
- Produces: table `show_crew_access(show_id, profile_id, organization_id)`; SQL functions `my_pm_show_ids() returns setof uuid`, `my_crew_member_ids() returns setof uuid`, `is_own_timecard(uuid) returns boolean` (real); `Role` = `'admin'|'staff'|'pm'|'crew'`.

- [ ] **Step 1: Write the failing checks.** Add fixtures after the Task 1 fixture block:

```ts
// sam is staffed on showA (crew-side there) and assigned to showA2 (PM-side there).
const [tcSam] = await q(`insert into timecards (room_id, crew_member_id, crew_member_name, role) values ($1,$2,'Sam Crew','A1') returning id`, [roomA.id, samCrewA.id])
const [punchSam] = await q(`insert into punches (timecard_id, punch_type, punched_at, source) values ($1,'start',now(),'crew') returning id`, [tcSam.id])
await q(`insert into show_assignments (show_id, profile_id) values ($1,$2)`, [showA2.id, sam])
```

and this block before `console.log('\n=== removed and misdirected users get nothing ===')` (after the 0028 block):

```ts
  console.log('\n=== crew-side: a staffed login sees only its own rows (0029) ===')
  {
    const [row] = await q(`select count(*)::int n from show_crew_access where show_id=$1 and profile_id=$2`, [showA.id, sam])
    check('staffing a linked person records their access to the show', row.n === 1, `${row.n}`)
  }
  await asUser(sam, async () => {
    const shows = await q(`select id from shows`)
    check('sam sees showA (staffed) and showA2 (assigned) and nothing else',
      shows.length === 2 && shows.some(s => s.id === showA.id) && shows.some(s => s.id === showA2.id), JSON.stringify(shows))
    const tcs = await q(`select id from timecards where show_id=$1`, [showA.id])
    check('on showA sam sees only their own timecard', tcs.length === 1 && tcs[0].id === tcSam.id, JSON.stringify(tcs))
    const pun = await q(`select id from punches where show_id=$1`, [showA.id])
    check('and only their own punches', pun.length === 1 && pun[0].id === punchSam.id, JSON.stringify(pun))
    const rates = await q(`select count(*)::int n from timecard_day_rates where show_id=$1`, [showA.id])
    check('and no rates', rates[0].n === 0, `${rates[0].n}`)

    const own = await probe(`update punches set punched_at=now() where id=$1`, [punchSam.id])
    check('sam can change their own punch', own.ok && own.n === 1, own.ok ? `${own.n} rows` : own.code)
    const ins = await probe(`insert into punches (timecard_id, punch_type, punched_at, source) values ($1,'meal_out',now(),'crew')`, [tcSam.id])
    check('and add one', ins.ok && ins.n === 1, ins.ok ? '' : ins.code)
    const other = await probe(`update punches set punched_at=now() where id=$1`, [punchA.id])
    check("but not somebody else's on the same show", !other.ok || other.n === 0, other.ok ? `${other.n} rows` : '')
    const flag = await probe(`update timecards set is_travel_day=true where id=$1`, [tcSam.id])
    check('and cannot change their own timecard flags', !flag.ok || flag.n === 0, flag.ok ? `${flag.n} rows` : '')

    const a2 = await q(`select count(*)::int n from timecards where show_id=$1`, [showA2.id])
    check('on showA2 (assigned) sam sees every timecard', a2[0].n === 1, `${a2[0].n}`)
    const pm = await q(`select count(*)::int n from my_pm_show_ids() f where f = $1`, [showA2.id])
    const notPm = await q(`select count(*)::int n from my_pm_show_ids() f where f = $1`, [showA.id])
    check('my_pm_show_ids() says PM on showA2, not on showA', pm[0].n === 1 && notPm[0].n === 0, `${pm[0].n} ${notPm[0].n}`)
  })
  // Declining removes access; unlinking removes access.
  await q(`update timecards set booking_status='declined' where id=$1`, [tcSam.id])
  await asUser(sam, async () => {
    const s = await q(`select count(*)::int n from shows where id=$1`, [showA.id])
    check('a declined booking takes the show away', s[0].n === 0, `${s[0].n}`)
  })
  await q(`update timecards set booking_status='confirmed' where id=$1`, [tcSam.id])
  await q(`update crew_members set profile_id=null where id=$1`, [samCrewA.id])
  await asUser(sam, async () => {
    const s = await q(`select count(*)::int n from shows where id=$1`, [showA.id])
    check('unlinking takes the show away', s[0].n === 0, `${s[0].n}`)
  })
  await q(`select relink_crew_member($1)`, [samCrewA.id])
  await asUser(sam, async () => {
    const s = await q(`select count(*)::int n from shows where id=$1`, [showA.id])
    check('relinking gives it back', s[0].n === 1, `${s[0].n}`)
  })
  // Unchanged for everyone else.
  await asUser(alice, async () => {
    const tcs = await q(`select count(*)::int n from timecards where show_id=$1`, [showA.id])
    check('an admin still sees every timecard on showA', tcs[0].n >= 2, `${tcs[0].n}`)
  })
  await asUser(dave, async () => {
    const tcs = await q(`select count(*)::int n from timecards where show_id=$1`, [showA.id])
    check('an assigned PM still sees every timecard on showA', tcs[0].n >= 2, `${tcs[0].n}`)
  })
  await asUser(carol, async () => {
    const tcs = await q(`select count(*)::int n from timecards where show_id=$1`, [showA.id])
    check('a view-only member (sees all shows) still sees every timecard', tcs[0].n >= 2, `${tcs[0].n}`)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls 2>&1 | grep -E "0029|✗|passed|failed"`
Expected: fails at `show_crew_access` (relation does not exist).

- [ ] **Step 3: Write the migration**

```sql
-- Section 2 of the 2026-09-06 spec: a staffed login sees only its own rows.
--
-- THE NEW DOOR. A show is visible when (today) can_see_all_shows() OR
-- created_by OR scheduler_id OR on show_assignments — OR (new) the caller's
-- linked directory entry has a live timecard on it. The shows policy must not
-- read timecards (timecards' policy reads shows — the recursion incident in
-- CLAUDE.md), so the fact lives in a bookkeeping table kept true by triggers,
-- exactly like show_assignments.organization_id.
--
-- PM-SIDE vs CREW-SIDE. On a visible show you are PM-side (see everything) if
-- can_see_all_shows(), or you created it, or you are its scheduler, or you are
-- on its access list — my_pm_show_ids(). Otherwise you are crew-side and see
-- only timecards whose crew_member is linked to you — my_crew_member_ids().
-- Both helpers are used as `in (select fn())`: one hashed subplan, never per row.
--
-- WRITES. is_own_timecard() — the placeholder 0019 left returning false — is
-- real from here. Timecard writes stay can_edit_timecards only.
--
-- NO CHANGE FOR EXISTING USERS: with no links, show_crew_access is empty and
-- my_crew_member_ids() is empty, so every rule reduces to today's.

-- 1. The bookkeeping table.
create table if not exists public.show_crew_access (
  show_id         uuid not null references public.shows(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (show_id, profile_id)
);
create index if not exists show_crew_access_profile_idx on public.show_crew_access (profile_id);
alter table public.show_crew_access enable row level security;
alter table public.show_crew_access force row level security;
-- Its policy references nothing but itself, so it can never form a cycle.
drop policy if exists "Users see their own crew access" on public.show_crew_access;
create policy "Users see their own crew access" on public.show_crew_access
  for select using (profile_id = (select auth.uid()));
grant select on public.show_crew_access to authenticated;

-- 2. Recompute for one (show, profile): a row exists iff a live timecard links them.
create or replace function public.refresh_show_crew_access(p_show_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_live boolean; v_org uuid;
begin
  if p_show_id is null or p_profile_id is null then return; end if;
  select exists (
    select 1 from timecards t join crew_members cm on cm.id = t.crew_member_id
    where t.show_id = p_show_id and cm.profile_id = p_profile_id
      and t.booking_status is distinct from 'declined'
  ) into v_live;
  if v_live then
    select organization_id into v_org from shows where id = p_show_id;
    insert into show_crew_access (show_id, profile_id, organization_id)
    values (p_show_id, p_profile_id, v_org) on conflict do nothing;
  else
    delete from show_crew_access where show_id = p_show_id and profile_id = p_profile_id;
  end if;
end; $$;

-- 3. Triggers that keep it true.
create or replace function public.timecards_crew_access_tg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_old uuid; v_new uuid;
begin
  if tg_op in ('DELETE','UPDATE') then
    select profile_id into v_old from crew_members where id = old.crew_member_id;
    perform refresh_show_crew_access(old.show_id, v_old);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select profile_id into v_new from crew_members where id = new.crew_member_id;
    perform refresh_show_crew_access(new.show_id, v_new);
  end if;
  return null;
end; $$;
drop trigger if exists timecards_crew_access on public.timecards;
create trigger timecards_crew_access
  after insert or delete or update of crew_member_id, booking_status, show_id on public.timecards
  for each row execute function public.timecards_crew_access_tg();

create or replace function public.crew_members_crew_access_tg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  for r in select distinct show_id from timecards where crew_member_id = new.id loop
    if old.profile_id is not null then perform refresh_show_crew_access(r.show_id, old.profile_id); end if;
    if new.profile_id is not null then perform refresh_show_crew_access(r.show_id, new.profile_id); end if;
  end loop;
  return null;
end; $$;
drop trigger if exists crew_members_crew_access on public.crew_members;
create trigger crew_members_crew_access
  after update of profile_id on public.crew_members
  for each row execute function public.crew_members_crew_access_tg();

-- Backfill (empty today — no links exist before 0028's backfill made some).
do $$ declare r record; begin
  for r in select distinct t.show_id, cm.profile_id from timecards t
           join crew_members cm on cm.id = t.crew_member_id where cm.profile_id is not null loop
    perform refresh_show_crew_access(r.show_id, r.profile_id);
  end loop;
end $$;

-- 4. Helpers.
create or replace function public.my_crew_member_ids() returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select id from crew_members where profile_id = auth.uid();
$$;

create or replace function public.my_pm_show_ids() returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select s.id from shows s
  where s.organization_id = my_organization_id()
    and ( can_see_all_shows()
       or s.created_by = auth.uid()
       or s.scheduler_id = auth.uid()
       or s.id in (select show_id from show_assignments where profile_id = auth.uid()) );
$$;

create or replace function public.is_own_timecard(p_timecard_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from timecards t join crew_members cm on cm.id = t.crew_member_id
    where t.id = p_timecard_id and cm.profile_id = auth.uid()
  );
$$;

-- 5. Policies. shows gains the door; timecards/punches filter per side.
alter policy "Users see their org shows" on public.shows
  using (
    organization_id = (select my_organization_id())
    and (
      (select can_see_all_shows())
      or id in (select show_id from show_assignments where profile_id = (select auth.uid()))
      or created_by = (select auth.uid())
      or scheduler_id = (select auth.uid())
      or id in (select show_id from show_crew_access where profile_id = (select auth.uid()))
    )
  );

alter policy "Users see timecards for their shows" on public.timecards
  using (
    show_id in (select id from shows)
    and ( show_id in (select my_pm_show_ids())
       or crew_member_id in (select my_crew_member_ids()) )
  );

alter policy "Users see punches for their timecards" on public.punches
  using (show_id in (select id from shows) and timecard_id in (select id from timecards));
```

- [ ] **Step 4: `crew` in the presets.** In `lib/permissions.ts`:

```ts
export type Role = 'admin' | 'staff' | 'pm' | 'crew'
```

and add to `PERMISSION_PRESETS`:

```ts
  // A crew member with a login (Section 2, 2026-09-06). No company permission
  // at all: what they may do comes from being STAFFED on a show — see their
  // own days, punch their own times. Not handed out by anything yet; the
  // invite path is a later round.
  crew: {
    can_manage_users: false,
    can_manage_billing: false,
    can_manage_crew_directory: false,
    can_import_crew: false,
    can_view_crew_contacts: false,
    can_create_shows: false,
    can_edit_all_shows: false,
    can_archive_shows: false,
    can_duplicate_shows: false,
    can_edit_timecards: false,
    can_approve_timecards: false,
    can_view_pay_rates: false,
    can_edit_pay_rates: false,
    can_manage_rulesets: false,
    can_view_reports: false,
    can_export_reports: false,
    can_send_reports: false,
    can_manage_scheduling: false,
    view_only: false,
  },
```

Run `npx tsc --noEmit`; anywhere `Role` is enumerated for a picker (grep `'pm'` in `components/PermissionsEditor.tsx`, `components/InviteTeammateModal.tsx`, `components/PendingInvitesList.tsx`) leave the picker lists as they are — `crew` is deliberately not offered yet — but fix any exhaustive `Record<Role, …>` the compiler flags by adding a `crew` entry with the label `'Crew'`.

- [ ] **Step 5: Apply, test, measure**

Run: `npm run db:migrate 2>&1 | tail -3 && npm run test:rls 2>&1 | grep -E "0029|✗|passed|failed"`
Expected: `ok`; all new checks ✓; `80 passed, 0 failed` (64 + 16).
Run: `npm run db:sql -- scripts/sql/checks/rls-cost.sql 2>&1 | grep -E "Execution Time|Planning Time"` and the app-shaped probe from the speed session if still in the scratchpad — the punch read must stay ~1–2 ms and no `Filter:` line may contain `my_pm_show_ids(` or `my_crew_member_ids(`: `... | grep -c "Filter:.*my_"` → `0`.

- [ ] **Step 6: Commit** — `scheduling`, preview only; dev migrated; production untouched

```bash
git add scripts/sql/migrations/0029_show_crew_access.sql scripts/test/rls.mts lib/permissions.ts
git commit -m "Migration 0029: a staffed login sees only its own rows; PM-side sees all; is_own_timecard() is real (Section 2).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 4: `lib/clockPunch.ts` — one set of punch rules for two routes

**Files:**
- Create: `lib/clockPunch.ts`
- Modify: `app/api/clock/punch/route.ts`
- Test: `scripts/test/clock.mts` (a pure-rules check of the shared decision function)

**Interfaces:**
- Produces:
  ```ts
  export type CrewPunchRequest = {
    timecardId: string; type: PunchType; at?: string; clear?: boolean
    crewMemberId: string; showId: string; sourceLink: string | null; createdBy: string | null
  }
  export type CrewPunchResult = { status: number; body: Record<string, unknown> }
  export async function applyCrewPunch(admin: SupabaseClient, req: CrewPunchRequest): Promise<CrewPunchResult>
  export function punchRefusal(all: Punch[], isTravelDay: boolean, absence: Absence | null, type: PunchType, mine: Punch | undefined): string | null
  ```
  `punchRefusal` is the pure "may this punch be made" decision (travel/absence/order/PM-owned), extracted so `clock.mts` can pin it without a database.

- [ ] **Step 1: Write the failing test** — append to `scripts/test/clock.mts`:

```ts
console.log('\n=== punchRefusal: the shared crew-punch decision ===')
import { punchRefusal } from '@/lib/clockPunch'
const P = (type: string, at: string, source: 'staff' | 'crew' = 'crew') => ({ id: type, punch_type: type as any, punched_at: at, source })
check('a fresh start is allowed', punchRefusal([], false, null, 'start', undefined), null)
check('M1 In without M1 Out is refused (the two-check rule)',
  typeof punchRefusal([P('start', '2026-09-01T13:00:00Z')], false, null, 'meal_in', undefined), 'string')
check('a travel day refuses everything', typeof punchRefusal([], true, null, 'start', undefined), 'string')
check('a cancelled day refuses everything', typeof punchRefusal([], false, 'cancelled', 'start', undefined), 'string')
check('correcting your own punch skips the order rule', punchRefusal([P('start', '2026-09-01T13:00:00Z')], false, null, 'start', P('start', '2026-09-01T13:00:00Z')), null)
check("a PM-entered punch cannot be changed", typeof punchRefusal([P('start', '2026-09-01T13:00:00Z', 'staff')], false, null, 'start', P('start', '2026-09-01T13:00:00Z', 'staff')), 'string')
```

Run: `npm run test:clock 2>&1 | tail -3` → fails: `Cannot find module '@/lib/clockPunch'`.

- [ ] **Step 2: Write `lib/clockPunch.ts`** — the whole of the token route's logic from "the timecard must be THIS person's" down to the write, parameterised:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PUNCH_ORDER, PUNCH_LABELS, getChronologyError, isEligibleForBatch, isWrapped,
  roundWallTime, clearBlockedReason, type Punch, type PunchType,
} from '@/lib/punches'
import type { Absence } from '@/lib/payroll'
import { zonedWallTimeToUtc, addDays } from '@/lib/datetime'

// Every rule of a crew member's own punch, in ONE place, used by both
//   app/api/clock/punch     — the no-login link (token = authorization)
//   app/api/clock/punch-me  — a signed-in crew-side login (Section 3, 2026-09-06)
// so the two cannot drift. The routes decide WHO is punching; this decides
// WHETHER and WHAT gets written. Service role throughout — see lib/clockSession.ts
// for why explicit column lists are the only protection here.

export type CrewPunchRequest = {
  timecardId: string
  type: PunchType
  /** HH:MM wall clock in the show's zone; omitted = now. Already validated by the route. */
  at?: string
  clear?: boolean
  /** Who is punching — resolved by the route from the token or the session. */
  crewMemberId: string
  showId: string
  /** clock_links.id for the token route, null for a login. */
  sourceLink: string | null
  /** auth.uid() for a login, null for a link. */
  createdBy: string | null
}

export type CrewPunchResult = { status: number; body: Record<string, unknown> }

const refuse = (status: number, error: string): CrewPunchResult => ({ status, body: { error } })

/**
 * Pure: may this punch be made? Null = yes; otherwise the sentence the crew
 * member reads. Order of checks matters and mirrors the tracker.
 */
export function punchRefusal(
  all: Punch[], isTravelDay: boolean, absence: Absence | null, type: PunchType,
  mine: (Punch & { source?: string }) | undefined,
): string | null {
  if (absence === 'cancelled') return 'That day was cancelled, so there are no punches to record. Talk to your PM if that is wrong.'
  if (absence === 'no_show') return 'That day is marked as a no-show. Talk to your PM if that is wrong.'
  if (isTravelDay) return 'That day is marked as a travel day, so there are no punches to record.'
  // A punch the PM entered is theirs; crew may fix their OWN mistake only.
  if (mine && mine.source !== 'crew') return `Your ${PUNCH_LABELS[type]} was set by your PM, so it can't be changed here. Ask them.`
  // ORDER, which chronology does not cover (the two-check rule, CLAUDE.md).
  // Skipped when correcting an existing punch: chronology is the judge then.
  if (!mine && !isEligibleForBatch(all, isTravelDay, type, absence)) {
    const requirement: PunchType | null =
      type === 'start' ? null : type === 'end' ? 'start' : PUNCH_ORDER[PUNCH_ORDER.indexOf(type) - 1]
    const why = isWrapped(all) && type !== 'end'
      ? 'You’ve already wrapped for today.'
      : requirement ? `Your ${PUNCH_LABELS[requirement]} isn’t recorded yet.` : 'That isn’t available right now.'
    return `${why} Ask your PM if that’s not right.`
  }
  return null
}

export async function applyCrewPunch(admin: SupabaseClient, req: CrewPunchRequest): Promise<CrewPunchResult> {
  const { timecardId, type, at, clear, crewMemberId, showId } = req

  const { data: show } = await admin
    .from('shows').select('id, organization_id, timezone_identifier, finalized_at')
    .eq('id', showId).maybeSingle()
  if (!show) return refuse(404, 'This show is not available.')
  const timeZone = show.timezone_identifier || 'America/Chicago'

  // Checked BEFORE writing: punches_blocked_when_finalized is a trigger and
  // the service role does not bypass triggers — otherwise a raw 500.
  if (show.finalized_at) {
    return refuse(400, 'This show has been closed out, so times can no longer be changed. Talk to your PM.')
  }

  // The timecard must be THIS person's and on THIS show; its work day supplies
  // the date, so the caller never names one.
  const { data: timecard } = await admin
    .from('timecards')
    .select('id, crew_member_id, is_travel_day, absence, rooms!inner ( work_days!inner ( date, show_id ) )')
    .eq('id', timecardId).maybeSingle()
  const room = Array.isArray((timecard as any)?.rooms) ? (timecard as any).rooms[0] : (timecard as any)?.rooms
  const workDay = Array.isArray(room?.work_days) ? room.work_days[0] : room?.work_days
  if (!timecard || timecard.crew_member_id !== crewMemberId || workDay?.show_id !== show.id || !workDay?.date) {
    return refuse(400, "That isn't one of your shifts on this show.")
  }
  const punchDate = workDay.date as string

  const { data: existing } = await admin
    .from('punches').select('id, punch_type, punched_at, source').eq('timecard_id', timecardId)
  const all: Punch[] = (existing || []).map(p => ({ id: p.id, punch_type: p.punch_type as PunchType, punched_at: p.punched_at }))
  const mine = (existing || []).find(p => p.punch_type === type)

  if (clear) {
    if (mine && mine.source !== 'crew') {
      return refuse(400, `Your ${PUNCH_LABELS[type]} was set by your PM, so it can't be cleared here. Ask them.`)
    }
    if (!mine) return refuse(400, 'There is nothing recorded to clear.')
    const blocked = clearBlockedReason(all, type)
    if (blocked) return refuse(400, blocked)
    const { data: gone, error } = await admin.from('punches').delete().eq('id', mine.id).select('id')
    if (error || !gone || gone.length === 0) return refuse(500, error?.message ?? 'That did not clear. Try again, or tell your PM.')
    return { status: 200, body: { ok: true, cleared: type } }
  }

  const refusal = punchRefusal(all, timecard.is_travel_day, (timecard.absence as Absence | null) ?? null, type, mine)
  if (refusal) return refuse(400, refusal)

  const { data: org } = await admin
    .from('organizations').select('timecard_rounding_minutes').eq('id', show.organization_id).maybeSingle()
  const roundingMinutes = org?.timecard_rounding_minutes ?? 1
  const wall = at ?? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  const { timeStr, dayOffset } = roundWallTime(wall, roundingMinutes)
  const now = zonedWallTimeToUtc(addDays(punchDate, dayOffset), timeStr, timeZone)

  const others: Punch[] = all.filter(p => p.punch_type !== type)
  const chronologyError = getChronologyError(now, type, others)
  if (chronologyError) return refuse(400, chronologyError)

  const stamp = { punched_at: now.toISOString(), source: 'crew' as const, source_link: req.sourceLink, created_by: req.createdBy }
  const written = mine
    ? await admin.from('punches').update(stamp).eq('id', mine.id).select('id')
    : await admin.from('punches').insert({ timecard_id: timecardId, punch_type: type, ...stamp }).select('id')
  if (written.error || !written.data || written.data.length === 0) {
    return refuse(500, written.error?.message ?? 'That did not save. Try again, or tell your PM.')
  }
  return { status: 200, body: { ok: true, punchType: type, punchedAt: now.toISOString() } }
}
```

Then check what the token route returns today on success (read the last 15 lines of `app/api/clock/punch/route.ts`) and make the success body above identical to it.

- [ ] **Step 3: Slim the token route.** In `app/api/clock/punch/route.ts`, keep: body parsing, the UUID/type/time validation, the rate limit, the link lookup, revoked/expired checks. Replace everything from `// Checked BEFORE writing.` to the end of the handler with:

```ts
  const result = await applyCrewPunch(admin, {
    timecardId, type, at, clear: !!clear,
    crewMemberId: link.crew_member_id, showId: show.id,
    sourceLink: link.id, createdBy: null,
  })
  return NextResponse.json(result.body, { status: result.status })
```

and import `applyCrewPunch` from `@/lib/clockPunch`; remove the now-unused imports (`PUNCH_ORDER`, `getChronologyError`, `isEligibleForBatch`, `isWrapped`, `roundWallTime`, `clearBlockedReason`, `zonedWallTimeToUtc`, `addDays`) — `npx tsc --noEmit` and the build's lint will name any that are still needed.

- [ ] **Step 4: Tests, then a real punch through the link on dev**

Run: `npm run test:clock 2>&1 | tail -3` → `59 passed` (53 + 6). `npx tsc --noEmit`.
Start dev; on the Cobalt show (dev) mint a personal link from Edit Show → Crew Clock, open it in the pane, punch Start on a day with no punches, confirm the row paints and `select source, source_link from punches order by created_at desc limit 1` on dev shows `crew` with a link id; then clear it via the dialog.

- [ ] **Step 5: Commit**

```bash
git add lib/clockPunch.ts app/api/clock/punch/route.ts scripts/test/clock.mts
git commit -m "Crew punch rules move to lib/clockPunch.ts so the link route and the coming login route cannot drift.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 5: The session route and the crew-side loader

**Files:**
- Create: `app/api/clock/punch-me/route.ts`
- Modify: `lib/clockSession.ts`
- Modify: `app/clock/[token]/ClockPunch.tsx`

**Interfaces:**
- Consumes: `applyCrewPunch` (Task 4), `my_pm_show_ids()` / `show_crew_access` (Task 3).
- Produces: `loadClockViewForProfile(showId, profileId, requestedDate?) : Promise<ClockView | null>`; `ClockPunch` props `endpoint?: string` (default `'/api/clock/punch'`) and `token?: string` (now optional).

- [ ] **Step 1: Split the day assembly out of `loadClockView`.** In `lib/clockSession.ts`, move the code from `// ---- Personal link: this person's own day` to the end of the assignments build into:

```ts
/**
 * This person's rooms and punches on ONE day of a show. Shared by the link
 * path and the login path (Section 3): same columns, same shape, same rules.
 */
async function assignmentsFor(
  admin: ReturnType<typeof createAdminClient>, crewMemberId: string, roomIds: string[], roomName: Map<string, string>,
): Promise<ClockAssignment[]> {
  const { data: mine } = await admin
    .from('timecards')
    .select('id, role, is_travel_day, absence, room_id')
    .eq('crew_member_id', crewMemberId)
    .in('room_id', roomIds)
    .neq('booking_status', 'declined')
  const timecardIds = (mine || []).map(t => t.id)
  const { data: punches } = timecardIds.length
    ? await admin.from('punches').select('id, timecard_id, punch_type, punched_at, source').in('timecard_id', timecardIds)
    : { data: [] as any[] }
  return (mine || []).map(t => ({
    timecardId: t.id,
    room: roomName.get(t.room_id) || 'Room',
    role: t.role ?? null,
    isTravelDay: t.is_travel_day === true,
    absence: t.absence === 'no_show' || t.absence === 'cancelled' ? t.absence : null,
    punches: (punches || [])
      .filter((p: any) => p.timecard_id === t.id)
      .map((p: any) => ({ id: p.id, punch_type: p.punch_type, punched_at: p.punched_at,
        source: (p.source === 'crew' ? 'crew' : 'staff') as 'staff' | 'crew' }))
      .sort((a: Punch, b: Punch) => a.punched_at.localeCompare(b.punched_at)),
  }))
}
```

and have `loadClockView`'s personal branch call `assignmentsFor(admin, link.crew_member_id, roomIds, roomName)`. Keep every comment that was in the moved block.

- [ ] **Step 2: The login loader.** Append to `lib/clockSession.ts`:

```ts
/**
 * The crew screen for a SIGNED-IN person on a show they are staffed on
 * (Section 3, 2026-09-06). Same view the link builds, minus the link: no
 * token, no expiry, no revocation — you are staffed or you are not.
 * `showId` must already have passed the caller's RLS (the page read it), and
 * the caller's directory entry is found through crew_members.profile_id.
 */
export async function loadClockViewForProfile(
  showId: string, profileId: string, requestedDate?: string,
): Promise<ClockView | null> {
  if (!UUID.test(showId) || !UUID.test(profileId)) return null
  const admin = createAdminClient()
  const { data: show } = await admin.from('shows')
    .select('id, name, venue, city_state, organization_id, timezone_identifier, finalized_at, end_date')
    .eq('id', showId).maybeSingle()
  if (!show) return null
  const [{ data: org }, { data: crew }] = await Promise.all([
    admin.from('organizations').select('name, timecard_rounding_minutes').eq('id', show.organization_id).maybeSingle(),
    admin.from('crew_members').select('id, full_name')
      .eq('organization_id', show.organization_id).eq('profile_id', profileId).maybeSingle(),
  ])
  if (!crew) return null

  const timeZone = show.timezone_identifier || 'America/Chicago'
  const today = todayInZone(timeZone)
  const { data: allDays } = await admin.from('work_days').select('date').eq('show_id', show.id).order('date')
  const days = (allDays ?? []).map(d => d.date as string)
  const selectedDate = requestedDate && days.includes(requestedDate) ? requestedDate : today

  const base: Omit<ClockView, 'kind' | 'me' | 'roster'> = {
    token: '',
    showId: show.id, showName: show.name, venue: show.venue ?? show.city_state ?? null,
    organizationName: org?.name ?? 'the production team', timeZone, today, selectedDate, days,
    roundingMinutes: org?.timecard_rounding_minutes ?? 1,
    finalized: !!show.finalized_at, expired: false, revoked: false,
  }
  const me = { crewMemberId: crew.id, name: crew.full_name, assignments: [] as ClockAssignment[] }
  const { data: workDay } = await admin.from('work_days').select('id').eq('show_id', show.id).eq('date', selectedDate).maybeSingle()
  if (!workDay) return { ...base, kind: 'personal', me, roster: [] }
  const { data: rooms } = await admin.from('rooms').select('id, name').eq('work_day_id', workDay.id)
  const roomIds = (rooms || []).map(r => r.id)
  const roomName = new Map((rooms || []).map(r => [r.id, r.name]))
  if (roomIds.length === 0) return { ...base, kind: 'personal', me, roster: [] }
  me.assignments = await assignmentsFor(admin, crew.id, roomIds, roomName)
  return { ...base, kind: 'personal', me, roster: [] }
}
```

- [ ] **Step 3: The session route.** Create `app/api/clock/punch-me/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PUNCH_ORDER, type PunchType } from '@/lib/punches'
import { applyCrewPunch } from '@/lib/clockPunch'

// A SIGNED-IN crew member recording their own punch (Section 3, 2026-09-06).
// The session is the authorization; the rules are lib/clockPunch.ts, shared
// with the no-login link route so the two can never disagree. Service role for
// the write, as the link route — but only after the caller's own RLS session
// has proved they can see the show, and the directory link has proved the
// timecard is theirs.
//
// No rate limit: this route is behind a login, which the public routes are not.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  let body: { showId?: string; timecardId?: string; punchType?: string; at?: string; clear?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }) }
  const { showId, timecardId, punchType, at, clear } = body
  if (!showId || !timecardId || !UUID.test(showId) || !UUID.test(timecardId)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!punchType || !(PUNCH_ORDER as readonly string[]).includes(punchType)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
    return NextResponse.json({ error: 'Invalid time.' }, { status: 400 })
  }

  // The caller's OWN session: can they see this show at all?
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  const { data: visible } = await supabase.from('shows').select('id, organization_id').eq('id', showId).maybeSingle()
  if (!visible) return NextResponse.json({ error: 'This show is not available.' }, { status: 404 })

  // Their directory entry in that company — the link 0028 made.
  const admin = createAdminClient()
  const { data: crew } = await admin.from('crew_members').select('id')
    .eq('organization_id', visible.organization_id).eq('profile_id', user.id).maybeSingle()
  if (!crew) return NextResponse.json({ error: "You aren't staffed on this show." }, { status: 403 })

  const result = await applyCrewPunch(admin, {
    timecardId, type: punchType as PunchType, at, clear: !!clear,
    crewMemberId: crew.id, showId, sourceLink: null, createdBy: user.id,
  })
  return NextResponse.json(result.body, { status: result.status })
}
```

- [ ] **Step 4: `ClockPunch` learns its endpoint.** In `app/clock/[token]/ClockPunch.tsx`: make `token` optional, add `endpoint = '/api/clock/punch'` and `showId?: string` props; in both `fetch('/api/clock/punch', …)` calls use `fetch(endpoint, …)` and a body of `{ ...(token ? { token } : { showId }), timecardId, punchType: type, … }`. Also: the day arrows build `?d=` links — they use `useRouter`/relative URLs already, so they work on any path; verify by reading the arrow `href`s.

- [ ] **Step 5: Type-check, run everything**

Run: `npx tsc --noEmit && npm test 2>&1 | grep -E "passed|failed"` → all green (the link path is unchanged in behaviour: re-open the dev personal link from Task 4 and punch once more).

- [ ] **Step 6: Commit**

```bash
git add lib/clockSession.ts app/api/clock/punch-me/route.ts app/clock/[token]/ClockPunch.tsx
git commit -m "Crew screen from a login: loadClockViewForProfile and /api/clock/punch-me, sharing the link path's assembly and rules.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 6: The show page branches; the other show pages send crew-side back

**Files:**
- Create: `components/CrewShowScreen.tsx`
- Modify: `app/dashboard/shows/[id]/page.tsx`
- Modify: `app/dashboard/shows/[id]/reports/page.tsx`, `app/dashboard/shows/[id]/edit/page.tsx`, `app/dashboard/shows/[id]/clock/print/page.tsx`
- Modify: `lib/session.ts`

**Interfaces:**
- Produces: `isPmOnShow(supabase, showId): Promise<boolean>` in `lib/session.ts` (`select 1 from my_pm_show_ids() f where f = $1` via `.rpc`) — used by all four pages.

- [ ] **Step 1: The helper.** Append to `lib/session.ts`:

```ts
/**
 * PM-side on this show? (Section 2, 2026-09-06.) True when the caller can see
 * every show, created it, is its scheduler, or is on its access list — the
 * same set the database uses to decide whether they see everyone's rows or
 * only their own. False means crew-side: staffed, sees only themselves.
 * One RPC; the helper is STABLE and cheap.
 */
export async function isPmOnShow(supabase: Awaited<ReturnType<typeof createClient>>, showId: string): Promise<boolean> {
  const { data } = await supabase.rpc('my_pm_show_ids')
  return Array.isArray(data) && data.some((row: any) => (typeof row === 'string' ? row : row?.my_pm_show_ids) === showId)
}
```

(Check the RPC's row shape once on dev via the pane: `supabase.rpc('my_pm_show_ids')` returns either `string[]` or `[{ my_pm_show_ids: uuid }]` depending on PostgREST's handling of `setof uuid`; the helper accepts both.)

- [ ] **Step 2: `CrewShowScreen`.** Create `components/CrewShowScreen.tsx`:

```tsx
import { loadClockViewForProfile } from '@/lib/clockSession'
import ClockPunch from '@/app/clock/[token]/ClockPunch'
import Link from 'next/link'

// What a CREW-SIDE login sees when they open a show: the crew clock, for one
// person, reached from a login instead of a link (Section 3, 2026-09-06).
// Same component the link renders; the only differences are the endpoint it
// posts to and the absence of expiry/revocation states.
export default async function CrewShowScreen({ showId, profileId, day }: { showId: string; profileId: string; day?: string }) {
  const view = await loadClockViewForProfile(showId, profileId, day)
  if (!view || !view.me) {
    return (
      <div className="p-6 md:p-10">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
        <p className="mt-4 text-sm text-muted">You aren’t staffed on this show.</p>
      </div>
    )
  }
  if (view.finalized) {
    return (
      <div className="p-6 md:p-10">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
        <h1 className="mt-4 font-display text-2xl font-bold uppercase tracking-wide">{view.showName}</h1>
        <p className="mt-2 text-sm text-muted">This show has been closed out, so times can no longer be changed.</p>
      </div>
    )
  }
  return (
    <ClockPunch
      key={view.selectedDate}
      endpoint="/api/clock/punch-me"
      showId={view.showId}
      showName={view.showName}
      venue={view.venue}
      crewName={view.me.name}
      timeZone={view.timeZone}
      roundingMinutes={view.roundingMinutes}
      selectedDate={view.selectedDate}
      today={view.today}
      days={view.days}
      assignments={view.me.assignments}
    />
  )
}
```

- [ ] **Step 3: The show page branches.** In `app/dashboard/shows/[id]/page.tsx`, `searchParams` type becomes `Promise<{ day?: string; d?: string }>`; right after `if (!user.organizationId) notFound()` add:

```ts
  // PM-side or crew-side? (Section 2.) Crew-side people get their own screen —
  // the crew clock — and never the tracker, which would be empty for them
  // anyway: the database hides every row but their own.
  const pmSide = await isPmOnShow(supabase, id)
  if (!pmSide) return <CrewShowScreen showId={id} profileId={user.id} day={(await searchParams).d} />
```

(import `isPmOnShow` from `@/lib/session` and `CrewShowScreen`). The tracker's `UnlockShowButton` gate changes in Task 7.

- [ ] **Step 4: The other three pages.** In each of reports, edit and clock/print `page.tsx`, immediately after the existing `if (!show) notFound()`:

```ts
  // Crew-side viewers have their own screen; everything else on the show
  // belongs to the PM (Section 3, 2026-09-06).
  if (!(await isPmOnShow(supabase, id))) redirect(`/dashboard/shows/${id}`)
```

(each page already imports `redirect`; add `isPmOnShow` to the `@/lib/session` import.) For the print page, `id` is the show id param — check its param name and use that.

- [ ] **Step 5: Dashboard gating check.** Read `app/dashboard/page.tsx` and `components/AppShell.tsx` for anything a permission-less user would see that they cannot use: "+ New Show" (already `can_create_shows`), Archive tab and Archive buttons (`can_archive_shows` — confirm), Staffing column (scheduling — confirm), Directory/Schedule nav (`can_manage_crew_directory` / `canUseScheduling` — confirm). Gate anything found ungated with the matching `user.can(...)`; record what was changed in the commit message.

- [ ] **Step 6: Prove it in the browser, end to end.** On dev:
  1. `update crew_members set email = '<your dev login email>' where id = '<a Cobalt crew member id>'` → the trigger links your login.
  2. Create a second membership? No — your dev login is an admin (sees all). To see crew-side, use dave's route: in the RLS suite `sam` already proves the database. For the UI, temporarily set your dev membership `can_edit_all_shows=false` and remove yourself from every access list except one show → open a show you are only staffed on → the crew screen renders; punch Start → row paints; `select source, created_by from punches order by created_at desc limit 1` shows `crew` and your uid; open `/reports` on it → redirected to the show. Open a show you created → the tracker. Put the membership back.
  3. `npx tsc --noEmit`, `npm run build`, `rm -rf .next`.

- [ ] **Step 7: Commit**

```bash
git add components/CrewShowScreen.tsx lib/session.ts app/dashboard/shows/[id]/page.tsx app/dashboard/shows/[id]/reports/page.tsx app/dashboard/shows/[id]/edit/page.tsx app/dashboard/shows/[id]/clock/print/page.tsx app/dashboard/page.tsx components/AppShell.tsx
git commit -m "A crew-side login opens a show onto the crew clock; reports/edit/print send them back (Section 3).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 7: Migration 0030 — unlock is for admins and the show's PM

**Files:**
- Create: `scripts/sql/migrations/0030_unlock_guard.sql`
- Modify: `scripts/test/rls.mts`, `components/UnlockShowButton.tsx`, `app/dashboard/shows/[id]/page.tsx`

- [ ] **Step 1: Failing checks** — before the `=== signed out` section in `rls.mts`:

```ts
  console.log('\n=== unlocking a finalized show (0030) ===')
  const tryUnlock = async (uid: string) => asUser(uid, async () => {
    await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
    return probe(`update shows set finalized_at=null where id=$1`, [showA.id])
  })
  await q(`update shows set finalized_at=now() where id=$1`, [showA.id])
  let r = await tryUnlock(alice); check('an admin can unlock', r.ok && r.n === 1, r.ok ? `${r.n}` : r.code)
  await q(`update shows set finalized_at=now() where id=$1`, [showA.id])
  r = await tryUnlock(dave); check("the show's assigned PM can unlock", r.ok && r.n === 1, r.ok ? `${r.n}` : r.code)
  await q(`update shows set finalized_at=now() where id=$1`, [showA.id])
  r = await tryUnlock(carol); check('a view-only member cannot', !r.ok || r.n === 0, r.ok ? `${r.n} rows` : '')
  r = await tryUnlock(sam); check('a crew-side person cannot', !r.ok || r.n === 0, r.ok ? `${r.n} rows` : '')
  await q(`update shows set finalized_at=null where id=$1`, [showA.id])
```

(`probe` inside `asUser` rolls back, so each attempt starts from a re-finalized show — hence the re-`update` lines. If `asUser` already sets the claims, drop the inner `set_config`.)

- [ ] **Step 2: Migration**

```sql
-- Section 5 of the 2026-09-06 spec: only an admin or the show's PM may
-- reopen a show whose Final Report was sent. Until now the button was hidden
-- from others but the database let anyone with can_edit_timecards do it.
create or replace function public.guard_show_unlock() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if old.finalized_at is not null and new.finalized_at is null and auth.uid() is not null then
    if not (my_perm('can_manage_users') or new.id in (select my_pm_show_ids())) then
      raise exception 'Only an admin or the show''s PM can unlock a finalized show.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists guard_show_unlock on public.shows;
create trigger guard_show_unlock before update of finalized_at on public.shows
  for each row execute function public.guard_show_unlock();
```

- [ ] **Step 3: UI.** In `app/dashboard/shows/[id]/page.tsx` the Unlock gate becomes `{(user.can('can_manage_users') || pmSide) && (…)}` — `pmSide` is true here by construction after Task 6's early return, so it reads `{true && …}`; write it as `{/* pmSide is always true past the crew-side return above */}` and render the button unconditionally for PM-side. In `components/UnlockShowButton.tsx` the header comment becomes "Admins and the show's PM — gated by guard_show_unlock() at the database (0030)". Wherever the locked banner copy says "An admin can unlock it" (grep `admin can unlock` in `app/`, `components/`, `lib/`, `scripts/sql/`), change to "An admin or the show's PM can unlock it." — including `block_writes_when_finalized`'s message, which needs a migration line: add to 0030 a `create or replace function public.block_writes_when_finalized()` with the identical body and the new sentence (copy the current body from `select pg_get_functiondef('public.block_writes_when_finalized'::regproc)` on dev; change only the string).

- [ ] **Step 4: Apply, test, build, commit**

Run: `npm run db:migrate 2>&1 | tail -3 && npm run test:rls 2>&1 | grep -E "0030|✗|passed|failed" && npx tsc --noEmit && npm run build && rm -rf .next`
Expected: 4 new ✓; `84 passed`.

```bash
git add scripts/sql/migrations/0030_unlock_guard.sql scripts/test/rls.mts components/UnlockShowButton.tsx app/dashboard/shows/[id]/page.tsx
git commit -m "Migration 0030: unlocking a finalized show is for admins and the show's PM, enforced at the database (Section 5).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```

---

### Task 8: Docs, harness, cutover

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md.** Add a section **"Show access: PM-side and crew-side (2026-09-06)"** after the crew clock section, covering: the two doors summary table (see-all / created / scheduler / access list = PM-side; staffed-and-linked = crew-side); `crew_members.profile_id` and the email rule (one company, exactly one match, case-insensitive, Unlink on Edit Crew); `show_crew_access` is trigger-owned, never written by the app, and exists because shows must not read timecards; `my_pm_show_ids()` / `my_crew_member_ids()` used only as `in (select …)`; `is_own_timecard()` is real; the `crew` preset is not handed out yet (invite path deferred); `lib/clockPunch.ts` is the one place crew-punch rules live and both routes call it; `isPmOnShow()` is how pages branch. Update the migrations list (0028–0030, dev-only until cutover), the schema section (`crew_members.profile_id`, `show_crew_access`), the security backlog (Unlock item DONE), "Already built" (crew-side logins model, minus invites), and the test count.

- [ ] **Step 2: Measure.** `npm run db:sql -- scripts/sql/checks/rls-cost.sql` on dev; record Execution/Planning for the admin read and the PM read in the CLAUDE.md speed paragraph if they moved by more than a millisecond.

- [ ] **Step 3: Commit docs; then STOP and report to Dan** with the blast radius: 0028–0030 are on dev; production needs backup → `db:migrate --prod` → `db:grants` → `db:schema` → merge `scheduling` → `main`. 0028's backfill WRITES `crew_members.profile_id` on production for every entry whose email matches exactly one member (say how many, from a read-only count: `select count(*) from crew_members cm where exists (select 1 from memberships m join profiles p on p.id=m.profile_id where m.organization_id=cm.organization_id and lower(p.email)=lower(cm.email))`). Nothing anyone sees changes until such a linked person opens the app — and every existing login is PM-side or sees-all today.

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: PM-side and crew-side, the email link, show_crew_access, the shared punch rules.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin scheduling
```
