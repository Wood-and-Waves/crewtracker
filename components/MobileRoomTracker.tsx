'use client'

import { useState } from 'react'
import AddRoomModal from '@/components/AddRoomModal'
import StaffRoomModal from '@/components/StaffRoomModal'
import TimecardRow from '@/components/TimecardRow'
import BatchPunchBar from '@/components/BatchPunchBar'
import RoomActionsMenu from '@/components/RoomActionsMenu'
import { cn } from '@/lib/cn'

type Room = { id: string; name: string }

export default function MobileRoomTracker({
  className,
  showId,
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
}: {
  className?: string
  showId: string
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
}) {
  const [selected, setSelected] = useState<'all' | string>('all')

  // A room may have been deleted out from under the selection — fall back.
  const activeRoom = selected === 'all' ? null : rooms.find(r => r.id === selected) ?? null
  const showAll = selected === 'all' || !activeRoom

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
      {/* Room selector — All Rooms + one pill per room, plus Add Room */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex gap-2 overflow-x-auto flex-1 -mx-1 px-1 py-1">
          <button
            onClick={() => setSelected('all')}
            className={cn(
              'shrink-0 rounded-pill px-4 py-2 text-sm font-semibold transition-colors',
              showAll ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted',
            )}
          >
            All Rooms
          </button>
          {rooms.map(room => (
            <button
              key={room.id}
              onClick={() => setSelected(room.id)}
              className={cn(
                'shrink-0 rounded-pill px-4 py-2 text-sm font-semibold transition-colors',
                selected === room.id ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted',
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
            <div className="rounded-card border border-line bg-surface overflow-hidden">
              <BatchPunchBar timecards={dayCrew} dayDate={dayDate} />
            </div>
          )}
          {rooms.map(room => {
            const crew = roomCrew[room.id] || []
            return (
              <div key={room.id} className="rounded-card border border-line bg-surface overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-line">
                  <h2 className="text-lg font-bold text-ink">{room.name}</h2>
                  <RoomActionsMenu roomId={room.id} roomName={room.name} crewCount={crew.length} />
                </div>
                <div>
                  {crew.length === 0 && <p className="text-sm text-muted p-4">No crew staffed yet.</p>}
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
            <div className="rounded-card border border-line bg-surface overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-line">
                <h2 className="text-lg font-bold text-ink">{activeRoom!.name}</h2>
                <RoomActionsMenu roomId={activeRoom!.id} roomName={activeRoom!.name} crewCount={crew.length} />
              </div>
              {crew.length > 0 && <BatchPunchBar timecards={crew} dayDate={dayDate} />}
              <div>
                {crew.length === 0 && <p className="text-sm text-muted p-4">No crew staffed yet.</p>}
                {rowsFor(crew)}
              </div>
              <div className="p-4 pt-3">
                <StaffRoomModal
                  organizationId={organizationId}
                  roomId={activeRoom!.id}
                  roomName={activeRoom!.name}
                  currentWorkDayId={currentWorkDayId}
                  remainingRoomIdsSameName={remainingRoomsByName[activeRoom!.id] || []}
                />
              </div>
            </div>
          )
        })()
      )}
    </div>
  )
}
