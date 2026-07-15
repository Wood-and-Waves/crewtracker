// Shared grid template for the tracker console's punch table, so the
// header row (rendered server-side by the page) and each TimecardRow
// (client component) stay perfectly aligned.
//
// Deliberately NOT in TimecardRow.tsx: that file is a 'use client'
// module, and non-component named exports (plain strings, etc.) from a
// client module can't be safely imported into a Server Component across
// the RSC boundary — Next.js serializes them into a broken reference
// instead of the value. Keep shared constants like this in a plain file.
export const PUNCH_GRID_COLS = 'lg:grid-cols-[1.7fr_repeat(6,1fr)_1fr]'
