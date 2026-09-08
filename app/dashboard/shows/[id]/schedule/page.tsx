import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canUseScheduling, isPmOnShow } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'
import { BAND } from '@/lib/panel'
import { cn } from '@/lib/cn'
import ScheduleBoard from '@/components/ScheduleBoard'
import PositionDefsSection from '@/components/PositionDefsSection'
import SendToSchedulingButton from '@/components/SendToSchedulingButton'
import AskPencilledButton from '@/components/AskPencilledButton'
import { buildBoard, describeBoard, type BoardBooking, type SlotFlag } from '@/lib/scheduleBoard'
import { summarizeCall, describeCallSize } from '@/lib/crewCall'

// The Scheduling screen (spec: 2026-09-07-scheduling-screen-design.md).
//
// Weeks before the show, at a desk: positions, filling, asking, answers, flags
// — everything the tracker's room ⋮ was carrying for a person who is neither
// the PM nor on site. Dan: "Too much lives there. Maybe scheduling is separate
// from the tracker." So this screen owns the whole job and the tracker keeps
// ONE scheduling thing: the status chip, while an answer is owed.
//
// Everything reads through the caller's session. A scheduler reaches a SENT
// show through the queue door in the shows policy (migration 0035), which also
// makes isPmOnShow true for them — so this page needs no permission logic of
// its own beyond the module gate.

export default async function ShowSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [user, { data: show }, { data: workDays }] = await Promise.all([
    getCurrentUser(),
    supabase.from('shows').select('*').eq('id', id).single(),
    supabase.from('work_days').select('id, date, day_number, activities').eq('show_id', id).order('day_number'),
  ])
  if (!user) redirect('/login')
  if (!show) notFound()
  // The module gate, not a permission: a company without scheduling has no such
  // screen, and a bookmark must not be the way around that.
  if (!canUseScheduling(user)) redirect(`/dashboard/shows/${id}`)
  if (!(await isPmOnShow(supabase, id))) redirect(`/dashboard/shows/${id}`)

  const days = (workDays ?? []).map((d: any) => ({ workDayId: d.id as string, date: d.date as string, activities: (d.activities ?? []) as string[] }))
  const workDayIds = days.map(d => d.workDayId)

  const { data: roomRows } = workDayIds.length
    ? await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', workDayIds).order('created_at')
    : { data: [] as any[] }
  const rooms = (roomRows ?? []).map((r: any) => ({ id: r.id as string, name: r.name as string, workDayId: r.work_day_id as string }))
  const roomIds = rooms.map(r => r.id)

  // The screen's one round of queries: this show's slots, its live bookings,
  // its flags, its definitions, the role list and the PM's name. None depends
  // on another's result.
  const [
    { data: slotRows }, { data: bookingRows }, { data: flagRows }, { data: defRows }, { data: roleRows }, { data: pmProfile },
  ] = await Promise.all([
    roomIds.length
      ? supabase.from('crew_call_positions').select('id, room_id, role, sort_order').in('room_id', roomIds).order('sort_order')
      : Promise.resolve({ data: [] as any[] }),
    // A declined person holds nothing, so they are filtered in SQL — the same
    // rule lib/timecardFields.ts applies everywhere else.
    supabase.from('timecards')
      .select('id, room_id, call_position_id, crew_member_id, crew_member_name, role, booking_status')
      .eq('show_id', id).neq('booking_status', 'declined'),
    supabase.from('position_slot_flags')
      .select('slot_id, position_def_id, room_name, date, role, timecard_id, crew_member_name, crew_member_id')
      .eq('show_id', id).order('date'),
    supabase.from('position_defs')
      .select('id, room_name, role, count, day_kind, custom_dates, sort_order').eq('show_id', id).order('sort_order'),
    supabase.from('av_roles').select('name').eq('organization_id', user.organizationId!).order('name'),
    show.pm_profile_id
      ? supabase.from('profiles').select('full_name, email').eq('id', show.pm_profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const board = buildBoard({
    days,
    rooms,
    slots: (slotRows ?? []).map((s: any) => ({ id: s.id, roomId: s.room_id, role: s.role, sortOrder: s.sort_order })),
    bookings: (bookingRows ?? []).map((t: any): BoardBooking & { roomId: string; slotId: string | null } => ({
      timecardId: t.id,
      roomId: t.room_id,
      slotId: t.call_position_id ?? null,
      crewMemberId: t.crew_member_id ?? null,
      crewMemberName: t.crew_member_name ?? 'Unnamed',
      role: t.role ?? '',
      status: (t.booking_status ?? 'pencilled') as BoardBooking['status'],
    })),
    flags: (flagRows ?? []) as SlotFlag[],
  })

  // The send-to-scheduling copy counts people per day, never position rows.
  const dateByRoomId = new Map(rooms.map(r => [r.id, days.find(d => d.workDayId === r.workDayId)?.date ?? '']))
  const callSummary = summarizeCall(
    (slotRows ?? []).map((s: any) => ({ date: dateByRoomId.get(s.room_id) ?? '' })).filter((r: any) => r.date),
  )

  const pmName = ((pmProfile as any)?.full_name || (pmProfile as any)?.email || null) as string | null
  const locked = !!show.finalized_at
  const short = (date: string) => new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const dates = days.length ? `${short(days[0].date)} – ${short(days[days.length - 1].date)}` : ''

  return (
    <div className="p-4 md:p-10 lg:mx-auto lg:max-w-[1500px]">
      <Link href={`/dashboard/shows/${id}`} className="text-sm text-muted hover:text-ink">← Back to the tracker</Link>

      {/* The screen's ONE solid band. Everything below is light strips and rules. */}
      <div className={cn(BAND, 'mt-2 flex flex-wrap items-center justify-between gap-3 px-4 py-3')}>
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold uppercase tracking-wide">{show.name}</h1>
          <p className="truncate text-xs opacity-80">
            Scheduling{dates ? ` · ${dates}` : ''}{show.venue ? ` · ${show.venue}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`/dashboard/shows/${id}/edit`}><Button variant="ghost" size="sm">Edit Show</Button></Link>
        </div>
      </div>

      {/* Where the show stands, and the things you do to the whole show: one
          line of counts, then the actions on the same rule. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line py-3">
        <p className="text-sm font-semibold text-ink">{describeBoard(board.summary)}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {pmName ? (
            <>
              <span>PM: <span className="text-ink">{pmName}</span></span>
              {show.pm_accepted_at ? <Chip tone="good">Accepted</Chip> : <Chip tone="ot">Not accepted yet</Chip>}
            </>
          ) : (
            <span>No PM yet</span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {show.sent_to_scheduling_at && <AskPencilledButton showId={id} />}
          <SendToSchedulingButton
            showId={id}
            sentAt={show.sent_to_scheduling_at ?? null}
            positionCount={callSummary.total}
            callSize={describeCallSize(callSummary)}
          />
        </div>
      </div>

      {locked && (
        <div className="mt-3 border-l-[3px] border-danger py-1 pl-3">
          <p className="text-sm font-semibold text-ink">Times locked</p>
          <p className="mt-1 text-xs text-muted">
            The final report has been sent, so staffing writes are refused until the show is unlocked.
          </p>
        </div>
      )}

      {days.length === 0 ? (
        <p className="py-8 text-sm text-muted">This show has no days yet.</p>
      ) : rooms.length === 0 ? (
        <p className="py-8 text-sm text-muted">
          No rooms yet. Add one from{' '}
          <Link className="font-semibold text-accent hover:underline" href={`/dashboard/shows/${id}`}>the tracker</Link>
          , then the positions go here.
        </p>
      ) : (
        <ScheduleBoard showId={id} board={board} locked={locked} />
      )}

      {/* The positions themselves, under the grid they explain. Flags show in
          the CELLS on this screen, so the section's own list is empty here. */}
      <div className="mt-8">
        <PositionDefsSection
          showId={id}
          roomNames={board.roomNames}
          roles={(roleRows ?? []).map((r: any) => r.name as string)}
          days={days.map(d => ({ date: d.date, activities: d.activities }))}
          defs={(defRows ?? []) as any[]}
          flags={[]}
          locked={locked}
        />
      </div>
    </div>
  )
}
