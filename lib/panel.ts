// The two class strings the ruled-section layout is built from.
//
// A screen's content sits inside a PANEL — one bordered surface. Where a screen
// repeats a unit (a room on the tracker, a work day in By Day, a person in By
// Crew) each unit gets its own panel; where it is one form or one table, there
// is one panel. What stays outside on the page background is the page header,
// any whole-screen summary, and the view controls.
//
// PANEL_X is the horizontal inset for a band inside a panel. It goes on the
// BANDS, never on the panel itself: padding sits inside the border box, so a
// band's `border-b` still spans the panel's full width and the hairlines run
// edge to edge. Pad the panel instead and every rule stops 16px short on both
// sides, which is the tell that someone has done it the other way round.
//
// Plain module with no 'use client' on purpose. Both Server Components (the
// reports page) and Client Components (New Show) import these. Exporting a
// non-component value from a 'use client' file for a Server Component to import
// silently serialises into a broken reference — that is the PUNCH_GRID_COLS
// incident in CLAUDE.md, which collapsed the tracker's layout with no error.

export const PANEL = 'rounded-card border border-line bg-surface'
export const PANEL_X = 'px-4'
