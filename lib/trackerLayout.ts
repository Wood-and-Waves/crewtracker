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
// Trailing tracks are travel, total and the row menu. Travel moved onto the row
// so a crew member is ONE line: it used to sit on a second row with Reset,
// which doubled every person's height for two toggles that are usually off.
const GRID_BY_PUNCH_COUNT: Record<number, string> = {
  6: 'lg:grid-cols-[1.7fr_repeat(6,minmax(0,1fr))_86px_84px_30px]',
  7: 'lg:grid-cols-[1.7fr_repeat(7,minmax(0,1fr))_86px_84px_30px]',
  8: 'lg:grid-cols-[1.7fr_repeat(8,minmax(0,1fr))_86px_84px_30px]',
}

/**
 * Grid template for a punch table showing `punchCount` punch columns.
 *
 * Six is the everyday case (Start, two meals, Wrap); seven and eight appear
 * only once a third break is under way. The count comes from the whole DAY so
 * every room matches — see visiblePunchTypes.
 */
export function punchGridCols(punchCount: number): string {
  return GRID_BY_PUNCH_COUNT[punchCount] ?? GRID_BY_PUNCH_COUNT[6]
}

/**
 * Which tracker tree a browser needs — see components/LayoutCookie.tsx.
 * The query must match Tailwind's `lg` breakpoint exactly, because the CSS
 * (`hidden lg:grid` / `lg:hidden`) is still the fallback when the cookie is
 * missing or stale; if the two ever disagree a viewport could see both trees
 * or neither.
 */
export const LAYOUT_COOKIE = 'ct-layout'
export const LAYOUT_QUERY = '(min-width: 1024px)'
export type TrackerLayout = 'desktop' | 'mobile'
