// The Open Paper layout vocabulary — and the grave of the panel.
//
// Dan, reviewing the Showbill B1 preview (2026-08-06): "I got hung up in the
// boldness of marquee and completely missed that it lives inside cards … No
// boxes is sooooooo much better." The paper IS the page: content sits directly
// on the ground, and boundaries come from these devices, never from enclosure:
//
//   BAND       — a solid masthead strip (a room on the tracker, a screen's
//                title block). On light it is an ink slab; on dark it is a
//                lifted strip under a bright rule. The 2px border-ink bottom
//                edge is part of the device: invisible against the light slab,
//                the lift itself on dark. A band is a STRONGER boundary than
//                any 1px frame was.
//   RULE_MAJOR — 3px ink, closing a section or a table.
//   hairlines  — `border-line`, for rows WITHIN a unit. Weight means something;
//                uniform hairlines everywhere was July's monotony bug.
//   whitespace — units are separated by space + the next band.
//
// What legitimately keeps a box: form fields (a printed form's fill-in boxes)
// and true overlays (dropdown menus, dialogs). Nothing else.
//
// Plain module, no 'use client' — see the PUNCH_GRID_COLS incident in CLAUDE.md.

export const BAND = 'bg-band text-band-ink border-b-2 border-ink'
export const RULE_MAJOR = 'border-b-[3px] border-ink'

// PANEL and PANEL_X (the enclosure era) are gone — the last importer died when
// Reports got its Open Paper pass. If you are looking for a box to put content
// in: don't. Fields and true overlays only.
