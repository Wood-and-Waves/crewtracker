// Shared grid template for the tracker console's punch table, so the
// header row (rendered server-side by the page) and each TimecardRow
// (client component) stay perfectly aligned.
//
// Deliberately NOT in TimecardRow.tsx: that file is a 'use client'
// module, and non-component named exports (plain strings, etc.) from a
// client module can't be safely imported into a Server Component across
// the RSC boundary — Next.js serializes them into a broken reference
// instead of the value. Keep shared constants like this in a plain file.
// One entry per number of visible meals. Written out as complete literal class
// names on purpose: Tailwind scans source text for class names, so a template
// string like `repeat(${n},1fr)` would never be generated at build time.
//
// Columns are name + two per meal + wrap + total.
//
// minmax(0,1fr) rather than plain 1fr: `1fr` means minmax(AUTO,1fr), so a track
// refuses to shrink below its content. At eight columns in a narrow room card
// the time buttons were wider than their equal share, which pushed the punch
// rows' tracks out while the header's — holding shorter text like "M1 Out" —
// stayed put. The two grids then disagreed and the table stopped lining up.
// A zero minimum keeps every track exactly equal and lets content shrink.
const GRID_BY_MEAL_COUNT: Record<number, string> = {
  1: 'lg:grid-cols-[1.7fr_repeat(4,minmax(0,1fr))_1fr]',
  2: 'lg:grid-cols-[1.7fr_repeat(6,minmax(0,1fr))_1fr]',
  3: 'lg:grid-cols-[1.7fr_repeat(8,minmax(0,1fr))_1fr]',
}

/**
 * Grid template for a room showing `mealCount` meal breaks.
 *
 * The count is per ROOM, not per crew member: this is a ruled table, and giving
 * each row its own column count would stop the rows lining up under the header.
 */
export function punchGridCols(mealCount: number): string {
  return GRID_BY_MEAL_COUNT[mealCount] ?? GRID_BY_MEAL_COUNT[2]
}
