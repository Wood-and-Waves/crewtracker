import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, canSeeFinancials as canSeeFinancialsFor } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  straightTimeHours, overtimeHours, doubleTimeHours,
  paidStraightTimeHours, paidOvertimeHours, paidDoubleTimeHours,
  mealPenaltyCount, mealPenaltyTotal, totalPay, isShortTurnaround,
  TimecardLike, PayrollRuleset,
} from '@/lib/payroll'
import { buildTimesheetText, buildSmsMessage } from '@/lib/timesheet'
import ExportCSVButton from '@/components/ExportCSVButton'
import ExportPDFButton from '@/components/ExportPDFButton'
import SendHoursButton from '@/components/SendHoursButton'
import SendFinalReportButton, { type PreSendIssue } from '@/components/SendFinalReportButton'
import Chip from '@/components/ui/Chip'
import SectionHead from '@/components/ui/SectionHead'
import { PANEL, PANEL_X } from '@/lib/panel'
import { cn } from '@/lib/cn'
import { fetchLiveTimecards, fetchShowRates, type TimecardRowMaybeRate } from '@/lib/timecardFields'

function fmt(n: number): string {
  if (n === 0) return '0'
  const rounded = Math.round(n * 100) / 100
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

// One column template for both views, so By Day and By Crew line up rather than
// each inventing its own table. Desktop is a real three-column ruled grid —
// label, breakdown, hours hard right. Below 1024px it drops to two columns and
// the breakdown moves onto a second line under the label, which is why every
// cell places itself explicitly instead of relying on auto-placement.
// The label column takes all the slack and the two number columns are fixed and
// adjacent, so breakdown sits beside its total instead of stranded mid-row —
// on a 1600px screen a proportional middle column puts 500px of nothing between
// a name and its hours.
const REPORT_COLS =
  'grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_200px_104px]'
const CELL_LABEL = 'col-start-1 row-start-1 min-w-0'
const CELL_BREAKDOWN = 'col-start-1 row-start-2 min-w-0 lg:col-start-2 lg:row-start-1'
const CELL_HOURS = 'col-start-2 row-start-1 text-right lg:col-start-3'

// Each repeating unit — a work day in By Day, a person in By Crew — is its own
// bordered surface, the same as a room on the tracker. What stays outside on the
// page background is the page header, the Master Summary and the view tabs:
// summaries and controls sit above the content, the content is what gets edges.
// PANEL / PANEL_X / SectionHead moved to lib/panel.ts and components/ui/ when
// New Show needed the same look — see the header of lib/panel.ts for why the
// inset belongs on the bands rather than on the panel.

// Column headers for the ruled table. Desktop only: at 375px the rows restack
// to two columns, and headers over a restacked layout label the wrong things.
function ColumnHeads({ label, className }: { label: string; className?: string }) {
  const cls = 'text-[10px] font-bold uppercase tracking-wide text-muted'
  return (
    <div className={cn('hidden gap-3 border-b border-line py-2 lg:grid', REPORT_COLS, className)}>
      <span className={cls}>{label}</span>
      <span className={cls}>Breakdown</span>
      <span className={cn(cls, 'text-right')}>Hours</span>
    </div>
  )
}

export default async function ShowReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { id } = await params
  const { view } = await searchParams
  const activeView = view === 'crew' ? 'crew' : 'day'

  const supabase = await createClient()

  // The caller and show/ruleset/workDays are independent of each other (none
  // depend on another's result) so fetch them in one round trip instead
  // of four sequential ones.
  const [
    user,
    { data: show },
    { data: rulesetRow },
    { data: workDays },
  ] = await Promise.all([
    getCurrentUser(),
    supabase.from('shows').select('*').eq('id', id).single(),
    supabase.from('payroll_rulesets').select('*').eq('show_id', id).single(),
    supabase.from('work_days').select('*').eq('show_id', id).order('day_number'),
  ])
  if (!user) redirect('/login')

  if (!show) notFound()

  // Financials only show in exports if BOTH the show tracks dollar amounts
  // AND the current user has permission to view pay rates.
  const canSeeFinancials = canSeeFinancialsFor(user, show.show_financials)

  // Amounts on SCREEN are masked under Shoulder Surfer Mode (iOS hideFinancials).
  // Exports stay unmasked — you deliberately asked for that file.
  const shoulderSurfer = user.shoulderSurfer
  // Hoisted: TypeScript drops the null-narrowing on `user` inside the timesheet
  // builder defined further down.
  const use24Hour = user.use24Hour
  const money = (n: number) => (shoulderSurfer ? '•••' : `$${n.toFixed(2)}`)

  const timezone = show.timezone_identifier || 'America/Chicago'

  const { data: organization } = user.organizationId
    ? await supabase.from('organizations').select('timecard_rounding_minutes, final_report_emails').eq('id', user.organizationId).single()
    : { data: null }
  const roundingMinutes = organization?.timecard_rounding_minutes ?? 1

  // Recipients are only counted here so the PM can be told how many addresses
  // exist. The route reads the actual list server-side; the client never sees
  // or supplies it.
  const recipientCount = (organization?.final_report_emails || '')
    .split(',').map((s: string) => s.trim()).filter(Boolean).length

  const workDayIds = (workDays || []).map(d => d.id)

  const { data: rooms } = workDayIds.length > 0
    ? await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', workDayIds)
    : { data: [] }

  const roomIds = (rooms || []).map(r => r.id)

  // Declined bookings excluded: they are not crew, so they belong in neither the
  // on-screen report nor the CSV/PDF the export buttons build from these rows —
  // and they would otherwise trip the pre-send checks as "not started".
  const rawTimecards = await fetchLiveTimecards<TimecardRowMaybeRate>(supabase, roomIds)

  // Rates come from the permission-checked view. Additionally gated on the
  // show's own financials flag: canSeeFinancials is the stricter test (show
  // tracks money AND this user may see rates), and every money figure on this
  // page is already behind it.
  const rateById = canSeeFinancials ? await fetchShowRates(supabase, id) : new Map<string, number>()

  // Reattach the rate here, once, so everything downstream — the payroll
  // mappings and the CSV/PDF export buttons — keeps seeing a normal timecard
  // with a day_rate on it. Zero for anyone not entitled to the real figure.
  const timecards = rawTimecards.map(tc => ({ ...tc, day_rate: rateById.get(tc.id) ?? 0 }))

  const timecardIds = (timecards || []).map(t => t.id)

  const { data: punches } = timecardIds.length > 0
    ? await supabase.from('punches').select('*').in('timecard_id', timecardIds)
    : { data: [] }

  // Phones for "Text Hours", keyed by crew_member_id. iOS matches the crew
  // member by NAME STRING, which breaks on duplicate names or a renamed
  // directory entry — the timecard carries the id, so join on that instead.
  const crewIdsOnShow = [...new Set((timecards || []).map(t => t.crew_member_id).filter(Boolean))]
  const { data: crewContacts } = crewIdsOnShow.length > 0
    ? await supabase.from('crew_members').select('id, phone').in('id', crewIdsOnShow)
    : { data: [] }
  const phoneById: Record<string, string | null> =
    Object.fromEntries((crewContacts || []).map(c => [c.id, c.phone]))

  if (!rulesetRow) {
    return (
      <div className="p-6 md:p-10">
        <Link href={`/dashboard/shows/${id}`} className="text-sm text-muted hover:text-ink">← Back to Show</Link>
        <h1 className="text-2xl font-bold mt-4">{show.name}</h1>
        <p className="text-muted mt-2">No payroll ruleset found for this show.</p>
      </div>
    )
  }
  const ruleset: PayrollRuleset = rulesetRow

  const allTimecards: TimecardLike[] = (timecards || []).map(tc => ({
    id: tc.id,
    crew_member_id: tc.crew_member_id,
    // 0 when unfetched — every money function is behind canSeeFinancials, which
    // is the same flag that decided whether to fetch it.
    day_rate: tc.day_rate ?? 0,
    is_travel_day: tc.is_travel_day,
    travel_in_day: tc.travel_in_day,
    travel_out_day: tc.travel_out_day,
    pay_as_half_day: tc.pay_as_half_day,
    punches: (punches || []).filter(p => p.timecard_id === tc.id),
  }))

  // Master Summary: PAID (ceiling-rounded) totals across the whole show.
  let totalPaidST = 0, totalPaidOT = 0, totalPaidDT = 0, totalLaborCost = 0
  for (const tc of allTimecards) {
    totalPaidST += paidStraightTimeHours(tc, allTimecards, ruleset, roundingMinutes)
    totalPaidOT += paidOvertimeHours(tc, allTimecards, ruleset, roundingMinutes)
    totalPaidDT += paidDoubleTimeHours(tc, allTimecards, ruleset, roundingMinutes)
    totalLaborCost += totalPay(tc, allTimecards, ruleset, roundingMinutes)
  }
  const totalPaidHours = totalPaidST + totalPaidOT + totalPaidDT

  // Pre-send checks for the Final Report. Strictly non-financial: the PM is
  // asserting times are complete, so they see what looks unfinished — never an
  // amount.
  const preSendIssues: PreSendIssue[] = (() => {
    const out: PreSendIssue[] = []
    const punchesFor = (tcId: string) => (punches || []).filter(p => p.timecard_id === tcId)

    const noStart = (timecards || []).filter(t =>
      !t.is_travel_day && !punchesFor(t.id).some(p => p.punch_type === 'start'))
    const noWrap = (timecards || []).filter(t =>
      !t.is_travel_day &&
      punchesFor(t.id).some(p => p.punch_type === 'start') &&
      !punchesFor(t.id).some(p => p.punch_type === 'end'))

    const nameList = (rows: any[]) => {
      const names = [...new Set(rows.map(r => r.crew_member_name))]
      return names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '')
    }

    if (noStart.length) out.push({
      label: `${noStart.length} not started`,
      detail: nameList(noStart),
    })
    if (noWrap.length) out.push({
      label: `${noWrap.length} never wrapped`,
      detail: nameList(noWrap),
    })

    const emptyRooms = (rooms || []).filter(r => !(timecards || []).some(t => t.room_id === r.id))
    if (emptyRooms.length) out.push({
      label: `${emptyRooms.length} empty ${emptyRooms.length === 1 ? 'room' : 'rooms'}`,
      detail: [...new Set(emptyRooms.map(r => r.name))].join(', '),
    })

    const emptyDays = (workDays || []).filter(d => {
      const dayRoomIds = (rooms || []).filter(r => r.work_day_id === d.id).map(r => r.id)
      return !(timecards || []).some(t => dayRoomIds.includes(t.room_id))
    })
    if (emptyDays.length) out.push({
      label: `${emptyDays.length} ${emptyDays.length === 1 ? 'day' : 'days'} with no crew`,
      detail: emptyDays.map(d => `Day ${d.day_number}`).join(', '),
    })

    return out
  })()

  function dayLabel(dateStr: string) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  }

  function findTc(rawTc: any): TimecardLike {
    return {
      id: rawTc.id,
      crew_member_id: rawTc.crew_member_id,
      day_rate: rawTc.day_rate ?? 0,
      is_travel_day: rawTc.is_travel_day,
      travel_in_day: rawTc.travel_in_day,
      travel_out_day: rawTc.travel_out_day,
      pay_as_half_day: rawTc.pay_as_half_day,
      punches: (punches || []).filter(p => p.timecard_id === rawTc.id),
    }
  }

  // Matches iOS breakdownString(for:) exactly: raw ST/OT/DT + meal penalty count.
  function breakdownString(rawTc: any) {
    const tc = findTc(rawTc)
    const st = straightTimeHours(tc, allTimecards, ruleset, roundingMinutes)
    const ot = overtimeHours(tc, allTimecards, ruleset, roundingMinutes)
    const dt = doubleTimeHours(tc, allTimecards, ruleset, roundingMinutes)
    const mp = mealPenaltyCount(tc, ruleset)
    const parts = [`${fmt(st)} ST`]
    if (ot > 0) parts.push(`${fmt(ot)} OT`)
    if (dt > 0) parts.push(`${fmt(dt)} DT`)
    if (mp > 0) parts.push(`${mp} MP`)
    return {
      text: parts.join(' | '),
      dayTotal: st + ot + dt,
      shortTurn: isShortTurnaround(tc, allTimecards, ruleset),
      mpCount: mp,
      mpTotal: mealPenaltyTotal(tc, ruleset),
      pay: totalPay(tc, allTimecards, ruleset, roundingMinutes),
    }
  }

  // Builds a crew member's own timesheet, server-side. Deliberately carries no
  // dollar figures, so it's always safe to hand to the crew member themselves.
  function timesheetFor(crew: { name: string; role: string; entries: any[] }) {
    const entries = crew.entries
      .map((rawTc: any) => {
        const room = (rooms || []).find(r => r.id === rawTc.room_id)
        const wd = (workDays || []).find(d => d.id === room?.work_day_id)
        return { date: wd?.date as string, timecard: findTc(rawTc) }
      })
      .filter(e => !!e.date)

    const text = buildTimesheetText({
      showName: show.name,
      crewName: crew.name,
      role: crew.role,
      entries,
      allTimecards,
      ruleset,
      roundingMinutes,
      timezone,
      use24Hour: use24Hour,
    })
    return { text, sms: buildSmsMessage(crew.name, show.name, text) }
  }

  return (
    <div className="p-6 md:p-10">
      <Link href={`/dashboard/shows/${id}`} className="text-sm text-muted hover:text-ink">← Back to Show</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{show.name} — Report</h1>
          {/* Date range, matching iOS's "Show Info" section. Date-only columns
              need the T00:00:00 suffix or they render a day early. */}
          <p className="text-sm text-muted mt-1">
            {new Date(show.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            {' – '}
            {new Date(show.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            {show.city_state ? ` · ${show.city_state}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportCSVButton
            showName={show.name}
            showFinancials={canSeeFinancials}
            rooms={rooms || []}
            workDays={workDays || []}
            timecards={timecards || []}
            punches={punches || []}
            ruleset={ruleset}
            timezone={timezone}
            use24Hour={use24Hour}
            roundingMinutes={roundingMinutes}
          />
          <ExportPDFButton
            showName={show.name}
            showFinancials={canSeeFinancials}
            startDate={show.start_date}
            endDate={show.end_date}
            clientCompany={show.client_company}
            jobNumber={show.job_number}
            cityState={show.city_state}
            rooms={rooms || []}
            workDays={workDays || []}
            timecards={timecards || []}
            punches={punches || []}
            ruleset={ruleset}
            timezone={timezone}
            use24Hour={use24Hour}
            roundingMinutes={roundingMinutes}
          />
          {user.can('can_send_reports') && !show.finalized_at && (
            <SendFinalReportButton
              showId={id}
              showName={show.name}
              recipientCount={recipientCount}
              issues={preSendIssues}
            />
          )}
        </div>
      </div>

      {show.finalized_at && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-line py-3">
          <Chip tone="neutral">Times locked</Chip>
          {/* Date AND time, in the SHOW's timezone — a lock stamped 11pm Pacific
              on a Chicago show reads as the wrong day without it. Honours the
              user's 24-hour preference, same as every other time in the app. */}
          <span className="text-sm text-muted">
            Final report sent{' '}
            {new Date(show.finalized_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit',
              hour12: !use24Hour,
              timeZone: timezone,
            })}
            . Punches and staffing are read-only.
          </span>
        </div>
      )}

      {/* The show's headline numbers, above the view tabs rather than below
          them: they are the same whichever view is open, and sitting under the
          tabs made them read as belonging to By Day.
          Four stats inline on one rule, the way the tracker header does it —
          this was a max-w-md card of stacked label/value rows. */}
      <section className="mt-6">
        <SectionHead title="Master summary" note="Paid hours — each day rounded up, as billed" />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-line py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total crew hours</p>
            <p className="text-lg font-bold tabular-nums text-ink">{fmt(totalPaidHours)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Straight time</p>
            <p className="text-lg font-bold tabular-nums text-ink">{fmt(totalPaidST)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Overtime</p>
            <p className="text-lg font-bold tabular-nums text-ink">{fmt(totalPaidOT)}</p>
          </div>
          {totalPaidDT > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Double time</p>
              <p className="text-lg font-bold tabular-nums text-ink">{fmt(totalPaidDT)}</p>
            </div>
          )}
          {canSeeFinancials && (
            <div className="lg:ml-auto lg:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Direct labor total</p>
              <p className="text-lg font-bold tabular-nums text-good">{money(totalLaborCost)}</p>
            </div>
          )}
        </div>
      </section>

      <div className="mb-6 mt-6 flex gap-2">
        <Link
          href="?view=day"
          className={cn(
            'rounded-field px-4 py-2 text-sm font-medium',
            activeView === 'day' ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink',
          )}
        >
          By Day
        </Link>
        <Link
          href="?view=crew"
          className={cn(
            'rounded-field px-4 py-2 text-sm font-medium',
            activeView === 'crew' ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink',
          )}
        >
          By Crew
        </Link>
      </div>

      {activeView === 'day' ? (
        <div className="flex flex-col gap-8">
          {(workDays || []).map(wd => {
            const dayRooms = (rooms || []).filter(r => r.work_day_id === wd.id)
            const dayRoomIds = dayRooms.map(r => r.id)
            const dayTimecards = (timecards || [])
              .filter(t => dayRoomIds.includes(t.room_id))
              .sort((a, b) => a.crew_member_name.localeCompare(b.crew_member_name))

            if (dayTimecards.length === 0) return null

            return (
              <section key={wd.id} className={PANEL}>
                <SectionHead
                  title={dayLabel(wd.date)}
                  note={`${dayTimecards.length} crew`}
                  className={cn(PANEL_X, 'pt-3')}
                />
                <ColumnHeads label="Crew" className={PANEL_X} />

                {dayTimecards.map(tc => {
                  if (tc.is_travel_day) {
                    return (
                      <div key={tc.id} className={cn('grid items-center gap-3 border-b border-line py-3 last:border-b-0', PANEL_X, REPORT_COLS)}>
                        <div className={CELL_LABEL}>
                          <p className="truncate text-sm text-ink">{tc.crew_member_name}</p>
                          <p className="truncate text-xs text-muted">{tc.role}</p>
                        </div>
                        <div className={CELL_BREAKDOWN}>
                          <span className="text-sm font-semibold text-accent">Travel Day</span>
                        </div>
                        <div className={CELL_HOURS}>
                          <span className="text-sm text-muted tabular-nums">—</span>
                        </div>
                      </div>
                    )
                  }
                  const b = breakdownString(tc)
                  return (
                    <div key={tc.id} className={cn('grid items-center gap-3 border-b border-line py-3 last:border-b-0', PANEL_X, REPORT_COLS)}>
                      <div className={cn(CELL_LABEL, 'flex items-center gap-1.5')}>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{tc.crew_member_name}</p>
                          <p className="truncate text-xs text-muted">{tc.role}</p>
                        </div>
                        {tc.travel_in_day && <span className="text-xs text-accent">✈️</span>}
                        {tc.travel_out_day && <span className="text-xs text-accent">✈️</span>}
                        {tc.pay_as_half_day && <span className="text-xs text-half-day">◑</span>}
                        {b.shortTurn && <span className="text-xs text-ot">⚠️</span>}
                      </div>
                      <div className={CELL_BREAKDOWN}>
                        <p className="text-xs text-muted">{b.text}</p>
                        {canSeeFinancials && b.mpTotal > 0 && (
                          <p className="text-xs text-ot">{b.mpCount} MP — {money(b.mpTotal)}</p>
                        )}
                      </div>
                      <div className={CELL_HOURS}>
                        <span className={cn('text-sm font-semibold tabular-nums', b.shortTurn ? 'text-ot' : 'text-ink')}>
                          {fmt(b.dayTotal)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
      ) : (
        // One crew member per full-width section, not a two-up grid of cards.
        // The cards were never the same height — a two-day crew member against a
        // ten-day one — so every other row had a ragged gap beside it, which is
        // the specific thing the card retirement is removing.
        <div className="flex flex-col gap-8">
          {Object.values(
            (timecards || []).reduce((acc: Record<string, any>, tc) => {
              const key = `${tc.crew_member_name}|${tc.role}`
              if (!acc[key]) acc[key] = {
                name: tc.crew_member_name,
                role: tc.role,
                crewMemberId: tc.crew_member_id,
                entries: [],
              }
              acc[key].entries.push(tc)
              return acc
            }, {})
          )
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
            .map((crew: any) => {
              let crewTotal = 0
              let crewPay = 0
              let crewMP = 0

              return (
                // Keyed on name AND role — the grouping is by `name|role`, so one
                // person billed in two roles would otherwise collide.
                <section key={`${crew.name}|${crew.role}`} className={PANEL}>
                  <div className={cn('flex items-start justify-between gap-3 border-b border-line pt-3 pb-2', PANEL_X)}>
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-bold text-ink">{crew.name}</h2>
                      <p className="truncate text-xs text-muted">{crew.role}</p>
                    </div>
                    {user.can('can_send_reports') && (() => {
                      const ts = timesheetFor(crew)
                      return (
                        <SendHoursButton
                          crewName={crew.name}
                          phone={crew.crewMemberId ? phoneById[crew.crewMemberId] ?? null : null}
                          timesheetText={ts.text}
                          smsMessage={ts.sms}
                        />
                      )
                    })()}
                  </div>

                  <ColumnHeads label="Day" className={PANEL_X} />

                  {/* Rows are direct children of the panel, not wrapped in a
                      div: `last:border-b-0` on a row must NOT fire here, because
                      the totals strip follows and the last day still needs a
                      rule separating it from the totals. Unwrapped, the totals
                      strip is the real last child, so no row matches. */}
                  {crew.entries
                      .slice()
                      .sort((a: any, b: any) => {
                        const wdA = (workDays || []).find(d => (rooms || []).find(r => r.id === a.room_id)?.work_day_id === d.id)
                        const wdB = (workDays || []).find(d => (rooms || []).find(r => r.id === b.room_id)?.work_day_id === d.id)
                        return (wdA?.date || '').localeCompare(wdB?.date || '')
                      })
                      .map((tc: any) => {
                        const wd = (workDays || []).find(d => {
                          const r = (rooms || []).find(rr => rr.id === tc.room_id)
                          return r?.work_day_id === d.id
                        })

                        // Resolved before the travel-day branch: a pure travel day
                        // contributes no hours but does contribute pay.
                        const b = breakdownString(tc)
                        crewPay += b.pay
                        crewMP += b.mpTotal

                        if (tc.is_travel_day) {
                          return (
                            <div key={tc.id} className={cn('grid items-center gap-3 border-b border-line py-3 last:border-b-0', PANEL_X, REPORT_COLS)}>
                              <div className={CELL_LABEL}>
                                <span className="truncate text-sm text-ink">{wd ? dayLabel(wd.date) : ''}</span>
                              </div>
                              <div className={CELL_BREAKDOWN}>
                                <span className="text-sm font-semibold text-accent">Travel Day</span>
                              </div>
                              <div className={CELL_HOURS}>
                                <span className="text-sm text-muted tabular-nums">—</span>
                              </div>
                            </div>
                          )
                        }

                        crewTotal += b.dayTotal

                        return (
                          <div key={tc.id} className={cn('grid items-center gap-3 border-b border-line py-3 last:border-b-0', PANEL_X, REPORT_COLS)}>
                            <div className={cn(CELL_LABEL, 'flex items-center gap-1')}>
                              <span className="truncate text-sm text-ink">{wd ? dayLabel(wd.date) : ''}</span>
                              {b.shortTurn && <span className="text-xs text-ot">⚠️</span>}
                              {tc.travel_in_day && <span className="text-xs text-accent">✈️</span>}
                              {tc.travel_out_day && <span className="text-xs text-accent">✈️</span>}
                              {tc.pay_as_half_day && <span className="text-xs text-half-day">◑</span>}
                            </div>
                            <div className={CELL_BREAKDOWN}>
                              <p className="text-xs text-muted">{b.text}</p>
                            </div>
                            <div className={CELL_HOURS}>
                              <span className={cn('text-sm font-semibold tabular-nums', b.shortTurn ? 'text-ot' : 'text-ink')}>
                                {fmt(b.dayTotal)}
                              </span>
                            </div>
                          </div>
                        )
                      })}

                  {/* Totals as an inline strip on a rule, the same shape as the
                      Master Summary above — every total on this page reads the
                      same way rather than each block inventing its own.
                      No bottom rule: this closes the panel, and a hairline one
                      pixel above the panel's own border reads as a double line. */}
                  <div className={cn('flex flex-wrap items-center gap-x-8 gap-y-2 py-3', PANEL_X)}>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total show hours</p>
                      <p className="text-base font-bold tabular-nums text-ink">{fmt(crewTotal)}</p>
                    </div>
                    {canSeeFinancials && crewMP > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Meal penalties</p>
                        <p className="text-base font-bold tabular-nums text-ot">{money(crewMP)}</p>
                      </div>
                    )}
                    {canSeeFinancials && (
                      <div className="lg:ml-auto lg:text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total pay</p>
                        <p className="text-base font-bold tabular-nums text-good">{money(crewPay)}</p>
                      </div>
                    )}
                  </div>
                </section>
              )
            })}
        </div>
      )}
    </div>
  )
}
