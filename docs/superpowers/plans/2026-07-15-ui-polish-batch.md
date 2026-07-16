# UI Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five small, independent UI fixes: remove wasted grid space around "Add Room," add a way to clear a punched time, icon-only Edit Show/View Report buttons on mobile, a label change, and a cleaner Crew Directory sort control.

**Architecture:** Each task touches 1-2 files and is independently shippable — no shared state between tasks except Task 5's new `components/ui/Dropdown.tsx` primitive, which only Task 5 consumes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 (Signal design tokens), existing `components/ui/*` primitives.

## Global Constraints

- **Never hardcode a color** — use Signal design tokens as Tailwind utilities (`bg-surface`, `bg-surface-2`, `text-ink`, `text-muted`, `border-line`, `text-accent`, `bg-accent-wash`, `text-danger`, `rounded-field`, `rounded-card`). No raw hex, no zinc-*.
- **No automated test framework** in this repo (`package.json` has no Jest/Vitest — only `build`/`lint`/`db:sql`). Per this project's established convention (see the two prior shipped plans this session), each task's verification is `npm run build` plus real browser verification via the preview tools — not automated tests.
- **Destructive actions use a native `confirm()` dialog** before proceeding, matching the existing pattern in `CrewDirectoryClient.tsx`'s `deleteCrew()` ("Delete this crew member? This cannot be undone.").
- **Responsive breakpoint convention:** `lg:` (1024px) is where this app's bottom tab-bar hands off to the desktop top-nav (see `components/AppShell.tsx`). Any mobile-vs-desktop split in this plan uses that same breakpoint.
- **Icon style convention:** outline-stroke SVGs, `viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"`, matching `components/AppShell.tsx`'s `Icon()` function.

---

## File Structure

- Modify: `app/dashboard/shows/[id]/page.tsx` — remove Add Room from the grid, add a header row for it (Task 1); icon-only Edit Show/View Report buttons below `lg:` (Task 3).
- Modify: `components/AddRoomModal.tsx` — restyle the closed-state trigger from a large dashed box to a small trailing button (Task 1).
- Modify: `components/TimeEntryModal.tsx` — add a "Clear" button + delete handler (Task 2).
- Modify: `components/StaffRoomModal.tsx` — label change only (Task 4).
- Create: `components/ui/Dropdown.tsx` — new token-styled dropdown primitive (Task 5).
- Modify: `components/CrewDirectoryClient.tsx` — replace native `<select>` with `Dropdown`, reposition next to search (Task 5).

---

### Task 1: Fix "Add Room" wasted space

**Files:**
- Modify: `components/AddRoomModal.tsx:75-83`
- Modify: `app/dashboard/shows/[id]/page.tsx:169-235`

**Interfaces:**
- `AddRoomModal` keeps its existing props (`showId`, `currentWorkDayId`, `remainingWorkDayIds`) — only its closed-state trigger markup changes. No prop/interface changes for `shows/[id]/page.tsx` to consume.

- [ ] **Step 1: Restyle the AddRoomModal trigger button**

In `components/AddRoomModal.tsx`, replace the closed-state return block:

```tsx
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-card border border-dashed border-line px-4 py-3 text-sm text-muted transition hover:border-accent hover:text-accent"
      >
        + Add Room
      </button>
    )
  }
```

with:

```tsx
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-field bg-accent-wash px-3 py-2 text-sm font-medium text-accent transition hover:opacity-80"
      >
        + Add Room
      </button>
    )
  }
```

(This matches the exact styling already used by `StaffRoomModal`'s "+ Staff Crew" trigger button — `rounded-field bg-accent-wash px-3 py-2 text-sm font-medium text-accent transition hover:opacity-80` — for visual consistency between the app's various "+ Add X" triggers.)

- [ ] **Step 2: Remove Add Room from the grid, add a header row above it**

In `app/dashboard/shows/[id]/page.tsx`, find this block:

```tsx
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {roomsList.map(room => {
```

Replace it with:

```tsx
      <div className="flex justify-end mb-3">
        <AddRoomModal
          showId={id}
          currentWorkDayId={activeDay.id}
          remainingWorkDayIds={remainingWorkDayIds}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {roomsList.map(room => {
```

Then find and delete the now-duplicate `AddRoomModal` block that currently sits inside the grid as its last child:

```tsx
        <div className="flex items-center justify-center rounded-card border border-dashed border-line p-5 min-h-[120px]">
          <AddRoomModal
            showId={id}
            currentWorkDayId={activeDay.id}
            remainingWorkDayIds={remainingWorkDayIds}
          />
        </div>
      </div>
    </div>
  )
}
```

Replace it with just:

```tsx
      </div>
    </div>
  )
}
```

(i.e., delete the entire `<div className="flex items-center justify-center rounded-card border border-dashed border-line p-5 min-h-[120px]">...</div>` block — the closing `</div></div>)` and the function's closing brace stay, only the dashed-box wrapper and its `AddRoomModal` instance are removed, since Add Room now lives in the new header row from Step 2 instead.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript/ESLint errors.

- [ ] **Step 4: Browser verification**

Using the preview tools, navigate to a show with exactly one room (or an existing test show):
- Confirm "+ Add Room" now appears as a small button in its own row, right-aligned, directly above the room card(s) — not as a large dashed box inside the grid.
- Confirm there is no empty/wasted-looking second grid column when there's only one room.
- Click "+ Add Room", confirm the modal still opens and creating a room still works.
- If a second room exists (or after adding one), confirm the two-room grid layout still looks correct (both cards, no leftover Add Room tile in the grid).

Capture a screenshot.

- [ ] **Step 5: Commit**

```bash
git add components/AddRoomModal.tsx "app/dashboard/shows/[id]/page.tsx"
git commit -m "Move Add Room out of the room grid to fix wasted space with one room"
```

---

### Task 2: Add a way to clear a punched time

**Files:**
- Modify: `components/TimeEntryModal.tsx`

**Interfaces:**
- No prop changes — `TimeEntryModal` already receives `timecardId`, `type`, `existingTime`, `onClose`, etc. from `components/TimecardRow.tsx:169-181`; nothing in the caller needs to change.

- [ ] **Step 1: Add a `clear()` handler and a Clear button**

In `components/TimeEntryModal.tsx`, add a new function alongside the existing `save()` function (insert directly after the closing brace of `save()`, i.e. after line 84 `}` and before the `return (` on line 86):

```tsx
  async function clearPunch() {
    if (!confirm('Clear this punch? This cannot be undone.')) return
    const existing = allPunches.find(p => p.punch_type === type)
    if (!existing) return

    setLoading(true)
    const { error } = await supabase.from('punches').delete().eq('id', existing.id)
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    router.refresh()
    onClose()
  }
```

Then update the button row. Replace:

```tsx
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1 py-3" onClick={onClose}>Cancel</Button>
              <Button className="flex-1 py-3" onClick={save} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </Button>
            </div>
```

with:

```tsx
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1 py-3" onClick={onClose}>Cancel</Button>
              {existingTime && (
                <Button variant="danger" className="flex-1 py-3" onClick={clearPunch} disabled={loading}>
                  Clear
                </Button>
              )}
              <Button className="flex-1 py-3" onClick={save} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </Button>
            </div>
```

(The `Clear` button only renders when `existingTime` is truthy — i.e., only when editing an already-punched time, never when adding a brand-new punch. Uses the existing `Button` component's `variant="danger"`, already defined in `components/ui/Button.tsx`.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Browser verification**

Using the preview tools, open a show's tracker page with at least one punch already recorded:
- Click an already-punched time cell — confirm the modal now shows three buttons: Cancel, Clear (red/danger styling), Save.
- Click Clear, confirm a browser confirm dialog appears with the text "Clear this punch? This cannot be undone."
- Confirm the dialog — verify the punch is removed (the cell reverts to its "not yet punched" empty/accent state) and the modal closes.
- Open a NOT-yet-punched cell (add a new punch) — confirm the Clear button does NOT appear (only Cancel/Save), since `existingTime` is null for a new punch.

Capture a screenshot of the modal showing the three-button state.

- [ ] **Step 4: Commit**

```bash
git add components/TimeEntryModal.tsx
git commit -m "Add Clear button to time entry modal for deleting a punched time"
```

---

### Task 3: Icon-only Edit Show / View Report buttons below lg:

**Files:**
- Modify: `app/dashboard/shows/[id]/page.tsx:134-140`

**Interfaces:** None — presentation-only change to an existing block, no new props or exports.

- [ ] **Step 1: Replace the button row with a responsive icon/text split**

In `app/dashboard/shows/[id]/page.tsx`, replace:

```tsx
        <div className="flex gap-2 mt-2">
          <Link href={`/dashboard/shows/${id}/edit`}>
            <Button variant="ghost" size="sm">Edit Show</Button>
          </Link>
          <Link href={`/dashboard/shows/${id}/reports`}>
            <Button variant="ghost" size="sm">View Report</Button>
          </Link>
        </div>
```

with:

```tsx
        <div className="flex gap-2 mt-2">
          <Link href={`/dashboard/shows/${id}/edit`}>
            <Button variant="ghost" size="sm" aria-label="Edit Show">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="lg:hidden">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              <span className="hidden lg:inline">Edit Show</span>
            </Button>
          </Link>
          <Link href={`/dashboard/shows/${id}/reports`}>
            <Button variant="ghost" size="sm" aria-label="View Report">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="lg:hidden">
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                <path d="M14 3v6h6" />
                <path d="M9 14h6M9 17h6" />
              </svg>
              <span className="hidden lg:inline">View Report</span>
            </Button>
          </Link>
        </div>
```

(Below `lg:`, the `lg:hidden` SVG shows and the `hidden lg:inline` text label is hidden — icon-only. At `lg:` and above, the SVG is hidden and the text label shows, matching current desktop behavior exactly. `aria-label` is added to both since the mobile state has no visible text.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Browser verification**

Using the preview tools:
- Resize to a mobile width (375px) and open a show detail page. Confirm "Edit Show" and "View Report" now render as icon-only buttons (pencil and document icons respectively), with the bottom tab-bar also visible below.
- Click each icon button, confirm they still navigate to `/dashboard/shows/[id]/edit` and `/dashboard/shows/[id]/reports` respectively.
- Resize to desktop width (1280px). Confirm the buttons revert to showing "Edit Show" / "View Report" text labels as before (no icons visible).

Capture screenshots at both widths.

- [ ] **Step 4: Commit**

```bash
git add "app/dashboard/shows/[id]/page.tsx"
git commit -m "Show icon-only Edit Show/View Report buttons below the lg: breakpoint"
```

---

### Task 4: "+ Staff Crew" → "Add Crew Member"

**Files:**
- Modify: `components/StaffRoomModal.tsx:152`

**Interfaces:** None — copy-only change.

- [ ] **Step 1: Change the label**

In `components/StaffRoomModal.tsx`, change:

```tsx
        + Staff Crew
```

to:

```tsx
        + Add Crew Member
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Browser verification**

Using the preview tools, open a show's tracker page. Confirm the button in each room card now reads "+ Add Crew Member" instead of "+ Staff Crew". Click it, confirm the staffing modal still opens and works as before.

- [ ] **Step 4: Commit**

```bash
git add components/StaffRoomModal.tsx
git commit -m "Rename Staff Crew button to Add Crew Member"
```

---

### Task 5: Crew Directory nav cleanup — replace native dropdown

**Files:**
- Create: `components/ui/Dropdown.tsx`
- Modify: `components/CrewDirectoryClient.tsx`

**Interfaces:**
- Produces: default-exported `Dropdown` component with props `{ value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }`. Task 5's own consumer (`CrewDirectoryClient.tsx`) is the only place using it in this plan.

- [ ] **Step 1: Create the Dropdown primitive**

Create `components/ui/Dropdown.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

export default function Dropdown({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find(o => o.value === value)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-field bg-surface-2 border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent hover:border-accent"
      >
        {current?.label || 'Select…'}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-full rounded-field border border-line bg-surface shadow-xl overflow-hidden">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => { onChange(option.value); setOpen(false) }}
              className={cn(
                'block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2',
                option.value === value ? 'text-accent font-semibold' : 'text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build with the new file (no consumer yet)**

Run: `npm run build`
Expected: build succeeds, no errors. (Nothing imports `Dropdown` yet — this just confirms the new file alone is valid TypeScript/JSX.)

- [ ] **Step 3: Replace the native select in CrewDirectoryClient and reposition it**

In `components/CrewDirectoryClient.tsx`, add the import (alongside the existing `Button` import):

```tsx
import Button from '@/components/ui/Button'
import Dropdown from '@/components/ui/Dropdown'
```

Remove the now-unused `selectCls` constant:

```tsx
const selectCls =
  'rounded-field bg-surface-2 border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent'
```
(delete this block entirely — `inputCls` above it stays)

Replace the header + search block:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Crew Directory</h1>
        <div className="flex flex-wrap items-center gap-2">
          {crew.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportCSV}>Export CSV</Button>
          )}
          <select value={sort} onChange={e => setSort(e.target.value as SortOption)} className={selectCls}>
            <option value="lastName" className="bg-surface-2 text-ink">Sort: Last Name</option>
            <option value="firstName" className="bg-surface-2 text-ink">Sort: First Name</option>
            <option value="role" className="bg-surface-2 text-ink">Sort: Role</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => setShowImport(true)}>Import</Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Person</Button>
        </div>
      </div>

      {crew.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search crew by name or role…"
          className={`${inputCls} mb-5 max-w-sm`}
        />
      )}
```

with:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Crew Directory</h1>
        <div className="flex flex-wrap items-center gap-2">
          {crew.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportCSV}>Export CSV</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowImport(true)}>Import</Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Person</Button>
        </div>
      </div>

      {crew.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search crew by name or role…"
            className={`${inputCls} max-w-sm`}
          />
          <Dropdown
            value={sort}
            onChange={v => setSort(v as SortOption)}
            options={[
              { value: 'lastName', label: 'Sort: Last Name' },
              { value: 'firstName', label: 'Sort: First Name' },
              { value: 'role', label: 'Sort: Role' },
            ]}
          />
        </div>
      )}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript/ESLint errors.

- [ ] **Step 5: Browser verification**

Using the preview tools, open `/dashboard/directory` with at least a few crew members:
- Confirm the button row now shows only Export CSV / Import / + Add Person (no dropdown in that row).
- Confirm a new custom dropdown control sits next to the search bar, styled with the app's tokens (not a raw OS `<select>`), reading "Sort: Last Name" by default.
- Click it, confirm a menu opens showing all three sort options with the current one highlighted in accent color.
- Click "Sort: First Name", confirm the menu closes, the button label updates to "Sort: First Name", and the crew list re-sorts accordingly.
- Click outside the open dropdown, confirm it closes without changing the selection.

Capture a screenshot of the open dropdown menu.

- [ ] **Step 6: Commit**

```bash
git add components/ui/Dropdown.tsx components/CrewDirectoryClient.tsx
git commit -m "Replace native sort dropdown with token-styled Dropdown component in Crew Directory"
```

---

## Spec Coverage Check

- Item 1 (Add Room wasted space) → Task 1. ✅
- Item 2 (clear a punched time) → Task 2. ✅
- Item 3 (icon-only Edit Show/View Report below lg:) → Task 3. ✅
- Item 4 (label change) → Task 4. ✅
- Item 5 (Directory nav cleanup: custom Dropdown + reposition) → Task 5. ✅
- Item 6 (pay-rule presets) → correctly absent, separate spec per the design doc.
