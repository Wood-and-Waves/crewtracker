// The whole show, as a place somebody can be staffed.
//
// A PM often works the SHOW rather than a room, and hours live on a timecard
// that must hang off a room (migration 0041 has the full reasoning and the two
// designs that were rejected). So the whole show IS a room, flagged: nothing
// downstream has to learn anything new — payroll groups it, reports print it,
// the crew clock finds it — and the screens that list rooms can say what it
// really is instead of an invented name.
//
// THE NAME IS STORED, not derived. `rooms.name` is not null and every existing
// reader prints it, so a show-wide room carries "Whole show" as its actual
// name: a screen that has never heard of the flag still says something true.
// The flag is what the screens that DO care read — ordering, and the pick-a-room
// step on the venue QR.
//
// A PM over one room only is NOT this: that is an ordinary timecard in that
// room with the PM role, and it has always worked. Nothing here may make that
// case harder than this one.

export const SHOW_WIDE_ROOM_NAME = 'Whole show'

export type RoomLike = { name: string; is_show_wide?: boolean | null }

export function isShowWide(room: RoomLike): boolean {
  return room.is_show_wide === true
}

/** What to print for a room. Falls back to the stored name. */
export function roomLabel(room: RoomLike): string {
  return isShowWide(room) ? SHOW_WIDE_ROOM_NAME : room.name
}

/**
 * THE WHOLE SHOW SITS ABOVE THE ROOMS, everywhere it appears (Dan, asking
 * where a PM belongs on the Scheduling screen: "Should they be at the top above
 * rooms?"). Rooms otherwise keep the order they were entered in, and a
 * show-wide room is usually created late — so left alone it would sort to the
 * bottom, under the spaces it is meant to sit over.
 *
 * Stable: rooms that are not show-wide come back in exactly the order given.
 */
export function orderRooms<T extends RoomLike>(rooms: T[]): T[] {
  return [...rooms.filter(isShowWide), ...rooms.filter(r => !isShowWide(r))]
}

/**
 * The rooms somebody picks from on the venue QR. The show-wide one is not a
 * place you can stand in, so it is not an answer to "which room are you in?" —
 * but the people staffed on it still have to be able to clock in, so they are
 * NOT dropped: the group is simply listed last, under the real rooms, where it
 * reads as "or, not in a room" rather than as a space nobody can find.
 */
export function orderRoomsForPicking<T extends RoomLike>(rooms: T[]): T[] {
  return [...rooms.filter(r => !isShowWide(r)), ...rooms.filter(isShowWide)]
}
