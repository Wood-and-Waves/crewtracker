'use client'

import { useState } from 'react'
import Link from 'next/link'
import AddRoomModal from '@/components/AddRoomModal'
import StaffRoomModal from '@/components/StaffRoomModal'
import TimecardRow from '@/components/TimecardRow'
import BatchPunchBar from '@/components/BatchPunchBar'
import RoomActionsMenu from '@/components/RoomActionsMenu'
import CopyCrewButton from '@/components/CopyCrewButton'
import { cn } from '@/lib/cn'

type CopySource = { roomId: string; count: number; dayNumber: number } | null

type Room = { id: string; name: string }

export default function MobileRoomTracker({
  className,
  showId,
  showName,
  showMeta,
  editHref,
  reportHref,
  dayNumber,
  totalDays,
  dateLabel,
  prevDayNumber,
  nextDayNumber,
  rooms,
  roomCrew,
  dayCrew,
  timezone,
  ruleset,
  allTimecards,
  dayDate,
  use24Hour,
  roundingMinutes,
  organizationId,
  currentWorkDayId,
  remainingWorkDayIds,
  remainingRoomsByName,
  dayAssignments,
  canViewRates,
  canEditRates,
  copySourceByRoom = {},
  addDayControl,
}: {
  className?: string
  showId: string
  showName: string
  showMeta?: string
  editHref: string
  reportHref: string
  dayNumber: number
  totalDays: number
  dateLabel: string
  prevDayNumber: number | null
  nextDayNumber: number | null
  rooms: Room[]
  roomCrew: Record<string, any[]>
  dayCrew: any[]
  timezone: string
  ruleset: any
  allTimecards: any[]
  dayDate: string
  use24Hour: boolean
  roundingMinutes: number
  organizationId: string
  currentWorkDayId: string
  remainingWorkDayIds: string[]
  remainingRoomsByName: Record<string, string[]>
  dayAssignments: { crewMemberId: string; roomId: string; roomName: string }[]
  canViewRates: boolean
  canEditRates: boolean
  copySourceByRoom?: Record<string, CopySource>
  /** Rendered in place of the next-day chevron on the last day. */
  addDayControl?: React.ReactNode
}) {
  const [selected, setSelected] = useState<'all' | string>('all')
  const [addCrewOpen, setAddCrewOpen] = useState(false)
  const [addCrewRoomId, setAddCrewRoomId] = useState<string | null>(null)
  const [roomPickerOpen, setRoomPickerOpen] = useState(false)

  // A room may have been deleted out from under the selection — fall back.
  const activeRoom = selected === 'all' ? null : rooms.find(r => r.id === selected) ?? null
  const showAll = selected === 'all' || !activeRoom
  const addCrewRoom = rooms.find(r => r.id === addCrewRoomId) ?? null

  function openAddCrew(roomId: string) {
    setAddCrewRoomId(roomId)
    setAddCrewOpen(true)
  }

  // Add-crew needs a concrete room. If a room is selected, use it. On
  // "All Rooms": one room → use it; several → ask which one first.
  function onAddCrewTap() {
    if (rooms.length === 0) return
    if (activeRoom) openAddCrew(activeRoom.id)
    else if (rooms.length === 1) openAddCrew(rooms[0].id)
    else setRoomPickerOpen(true)
  }

  // Empty roster: offer the previous day's same-named room, like iOS.
  function emptyRoster(roomId: string) {
    const src = copySourceByRoom[roomId]
    return (
      <>
        <p className="text-sm text-muted p-4 pb-2">No crew staffed yet.</p>
        {src && (
          <CopyCrewButton
            targetRoomId={roomId}
            sourceRoomId={src.roomId}
            sourceDayNumber={src.dayNumber}
            count={src.count}
          />
        )}
      </>
    )
  }

  function rowsFor(crew: any[]) {
    return crew.map(tc => (
      <TimecardRow
        key={tc.id}
        timecard={tc}
        punches={tc.punches}
        timezone={timezone}
        ruleset={ruleset}
        allTimecards={allTimecards}
        dayDate={dayDate}
        use24Hour={use24Hour}
        roundingMinutes={roundingMinutes}
      />
    ))
  }

  return (
    <div className={className}>
      {/* Compact header: show info, iOS-style action icons, day nav */}
      <div className="mb-6">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>
        <div className="flex items-start justify-between gap-3 mt-2">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight truncate">{showName}</h1>
            {showMeta && <p className="text-sm text-muted truncate">{showMeta}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={editHref}
              aria-label="Show info"
              className="flex h-9 w-9 items-center justify-center rounded-field bg-surface border border-line text-ink hover:border-accent hover:text-accent"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="11" x2="12" y2="16" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </Link>
            <Link
              href={reportHref}
              aria-label="View report"
              className="flex h-9 w-9 items-center justify-center rounded-field bg-surface border border-line text-ink hover:border-accent hover:text-accent"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M12 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v3" />
                <circle cx="16.5" cy="17.5" r="2.5" />
                <path d="M18.5 19.5 21 22" />
              </svg>
            </Link>
            <button
              onClick={onAddCrewTap}
              disabled={rooms.length === 0}
              aria-label="Add crew member"
              className="flex h-9 w-9 items-center justify-center rounded-field bg-surface border border-line text-ink hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="7" r="3" />
                <path d="M3 21v-1a5 5 0 0 1 5-5h2.5" />
                <path d="M16 11h6M19 8v6" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 mt-5">
          <Link
            href={prevDayNumber ? `?day=${prevDayNumber}` : '#'}
            aria-label="Previous day"
            className={cn(
              'rounded-full h-9 w-9 flex items-center justify-center shrink-0',
              !prevDayNumber ? 'pointer-events-none bg-surface-2 text-muted opacity-30' : 'bg-accent text-accent-ink',
            )}
          >
            ‹
          </Link>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-muted font-semibold">Day {dayNumber} of {totalDays}</p>
            <p className="text-lg font-bold text-ink tabular-nums">{dateLabel}</p>
          </div>
          {nextDayNumber ? (
            <Link
              href={`?day=${nextDayNumber}`}
              aria-label="Next day"
              className="rounded-full h-9 w-9 flex items-center justify-center shrink-0 bg-accent text-accent-ink"
            >
              ›
            </Link>
          ) : (
            addDayControl ?? (
              <span className="rounded-full h-9 w-9 flex items-center justify-center shrink-0 bg-surface-2 text-muted opacity-30">›</span>
            )
          )}
        </div>
      </div>

      {/* Room selector — All Rooms + one pill per room, plus Add Room */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex gap-2 overflow-x-auto flex-1 -mx-1 px-1 py-1">
          <button
            onClick={() => setSelected('all')}
            className={cn(
              'shrink-0 rounded-pill px-4 py-2.5 text-base font-semibold transition-colors',
              showAll ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink',
            )}
          >
            All Rooms
          </button>
          {rooms.map(room => (
            <button
              key={room.id}
              onClick={() => setSelected(room.id)}
              className={cn(
                'shrink-0 rounded-pill px-4 py-2.5 text-base font-semibold transition-colors',
                selected === room.id ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink',
              )}
            >
              {room.name}
            </button>
          ))}
        </div>
        <AddRoomModal
          showId={showId}
          currentWorkDayId={currentWorkDayId}
          remainingWorkDayIds={remainingWorkDayIds}
        />
      </div>

      {showAll ? (
        <div className="space-y-4">
          {dayCrew.length > 0 && (
            <div className="rounded-card border border-line bg-surface">
              <BatchPunchBar timecards={dayCrew} dayDate={dayDate} timezone={timezone} />
            </div>
          )}
          {rooms.map(room => {
            const crew = roomCrew[room.id] || []
            return (
              <div key={room.id} className="rounded-card border border-line bg-surface">
                <div className="flex items-center justify-between p-4 border-b border-line">
                  <h2 className="text-lg font-bold text-ink">{room.name}</h2>
                  <RoomActionsMenu roomId={room.id} roomName={room.name} crewCount={crew.length} crew={crew.map(tc => ({ id: tc.id, crewMemberId: tc.crew_member_id, name: tc.crew_member_name, role: tc.role, dayRate: tc.day_rate ?? 0 }))} canViewRates={canViewRates} canEditRates={canEditRates} />
                </div>
                <div>
                  {crew.length === 0 && emptyRoster(room.id)}
                  {rowsFor(crew)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        (() => {
          const crew = roomCrew[activeRoom!.id] || []
          return (
            <div className="rounded-card border border-line bg-surface">
              <div className="flex items-center justify-between p-4 border-b border-line">
                <h2 className="text-lg font-bold text-ink">{activeRoom!.name}</h2>
                <RoomActionsMenu roomId={activeRoom!.id} roomName={activeRoom!.name} crewCount={crew.length} crew={crew.map(tc => ({ id: tc.id, crewMemberId: tc.crew_member_id, name: tc.crew_member_name, role: tc.role, dayRate: tc.day_rate ?? 0 }))} canViewRates={canViewRates} canEditRates={canEditRates} />
              </div>
              {crew.length > 0 && <BatchPunchBar timecards={crew} dayDate={dayDate} timezone={timezone} />}
              <div>
                {crew.length === 0 && emptyRoster(activeRoom!.id)}
                {rowsFor(crew)}
              </div>
            </div>
          )
        })()
      )}

      {/* Room chooser — shown when adding crew from "All Rooms" */}
      {roomPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-card bg-surface border border-line p-6 shadow-xl">
            <h2 className="text-lg font-bold text-ink mb-1">Add crew to which room?</h2>
            <p className="text-xs text-muted mb-4">Pick a room to staff for this day.</p>
            <div className="flex flex-col gap-2">
              {rooms.map(room => (
                <button
                  key={room.id}
                  onClick={() => {
                    setRoomPickerOpen(false)
                    openAddCrew(room.id)
                  }}
                  className="w-full rounded-field bg-surface-2 px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-surface-3"
                >
                  {room.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setRoomPickerOpen(false)}
              className="mt-4 w-full rounded-field border border-line px-4 py-2.5 text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Controlled add-crew modal, opened by the header person+ icon */}
      {addCrewRoom && (
        <StaffRoomModal
          open={addCrewOpen}
          onOpenChange={setAddCrewOpen}
          hideTrigger
          organizationId={organizationId}
          roomId={addCrewRoom.id}
          roomName={addCrewRoom.name}
          currentWorkDayId={currentWorkDayId}
          remainingRoomIdsSameName={remainingRoomsByName[addCrewRoom.id] || []}
          dayAssignments={dayAssignments}
        />
      )}
    </div>
  )
}
