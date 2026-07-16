# UI Polish Batch — Design Spec

## Problem

Five small UI issues Dan noted while using the app. Each is independent and small; batched into one spec/plan rather than five separate cycles. (A sixth item — named, reusable pay-rule presets — is a real feature, not a tweak, and is explicitly out of scope here; it gets its own spec.)

## Item 1: Tracker page — "Add Room" wastes space when there's only one room

**Current:** `app/dashboard/shows/[id]/page.tsx:169-235` puts room cards and the "Add Room" trigger as siblings inside one `grid grid-cols-1 xl:grid-cols-2 gap-4`. The trigger's parent wrapper (`shows/[id]/page.tsx:228`) is a `min-h-[120px]` dashed box matching room-card sizing. With one room, this leaves an equally-sized empty-looking tile taking up the second grid column on `xl:` screens.

**Fix:** Remove "Add Room" from the grid entirely. Restyle its trigger button (`components/AddRoomModal.tsx:75-83`, currently a large dashed box) into a small trailing button, and place it in a new right-aligned row directly above the room grid — matching the "+ Add Person" pattern already used in Crew Directory. No wasted space regardless of room count (1, 2, or many).

## Item 2: Clear a punched time

**Current:** `components/TimeEntryModal.tsx` only offers Cancel/Save — no way to delete a specific punch. The existing "Undo" button (`components/TimecardRow.tsx:54-61`, `undoLast()`) only removes the most recent punch in sequence; it can't clear an arbitrary earlier one (e.g. clearing "Meal Out" while "Meal In" already exists).

**Fix:** Add a "Clear" button to `TimeEntryModal`, shown only when editing an existing punch (`existingTime` is set). On click, show a native `confirm()` dialog ("Clear this punch? This cannot be undone.") — matching the existing destructive-action pattern used for crew/room deletion — then delete that punch by id, refresh, and close.

## Item 3: Bottom-bar icons for Edit Show / View Report

**Current:** `app/dashboard/shows/[id]/page.tsx:134-140` renders "Edit Show" and "View Report" as text `Button`s at all screen widths.

**Fix:** Below `lg:` (1024px, where the bottom tab-bar takes over per the app's responsive-nav convention), render these as icon-only buttons instead of text buttons — a pencil icon for Edit Show, a document/chart icon for View Report — matching the existing outline-stroke SVG style already used for the bottom-tab icons in `components/AppShell.tsx`'s `Icon()` function. At `lg:` and above, keep the current text buttons (there's no tab-bar to match there).

## Item 4: "+ Staff Crew" → "Add Crew Member"

**Current:** `components/StaffRoomModal.tsx:152` — trigger button reads "+ Staff Crew".

**Fix:** Change the label to "Add Crew Member". One-line copy change, no behavior change.

## Item 5: Crew Directory top nav cleanup

**Current:** `components/CrewDirectoryClient.tsx` renders a native `<select>` (`selectCls`, browser-default-styled dropdown) for sort, inline in the same button row as Export CSV / Import / + Add Person.

**Fix:**
- New reusable primitive `components/ui/Dropdown.tsx` — a token-styled button-trigger dropdown (matching `Button`'s visual language: `bg-surface`, `border-line`, `rounded-field`), replacing the native `<select>`. Props: `value`, `options: { value: string; label: string }[]`, `onChange`.
- Reposition the sort control out of the action-button row, placing it next to the search input instead — sort is a view-of-the-list control, conceptually separate from Export/Import/Add actions.
- `CrewDirectoryClient.tsx` is the only current consumer, but `Dropdown` is written as a generic primitive in `components/ui/` (matching where `Button`/`Toggle`/`Chip` live) since the same "raw `<select>` looks bad" issue could recur elsewhere.

## Out of scope

- Item 6 (named, reusable pay-rule presets) — separate spec, larger feature (new data model + two new screens).
- Any change to the underlying punch/room/crew data model — all five items are presentation-layer only.
