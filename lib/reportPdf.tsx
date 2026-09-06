// The payroll PDF document.
//
// Plain module (no 'use client') so the browser download button and the
// server-side Final Report email render the same document — see CLAUDE.md on
// the client/server export rule. @react-pdf/renderer is imported by the caller
// and passed in, so this module stays free of the heavy dependency and works in
// both environments (browser: pdf(doc).toBlob(); server: renderToBuffer(doc)).
//
// Closes the iOS PDF gaps from sweep 2: client/job/city in the header, page
// numbers, a per-crew total pay line, and the per-day ST Penalty / travel /
// half-day markers iOS draws.

import {
  straightTimeHours, overtimeHours, doubleTimeHours,
  paidStraightTimeHours, paidOvertimeHours, paidDoubleTimeHours,
  travelLegPay, totalPay, isShortTurnaround,
  type TimecardLike, type PayrollRuleset,
} from '@/lib/payroll'
import { toTimecardLike, workDayFor } from '@/lib/reportCsv'
import { MEAL_PAIRS, mealLabel } from '@/lib/punches'

const fmt2 = (n: number) => n.toFixed(2)

// Day rates are nearly always whole dollars; printing "$500" rather than
// "$500.00" keeps the narrow Rate column from wrapping. Cents show when real.
const money = (n: number) => Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`

/**
 * A crew member's day rate lives on each timecard, so one person can hold
 * different rates across days of the same show. One rate prints plainly; more
 * than one prints a range, and the per-day rate is then shown on every entry
 * row so the range is never ambiguous.
 */
function rateLabel(rates: number[]): string {
  if (rates.length === 0) return '—'
  if (rates.length === 1) return money(rates[0])
  const low = Math.round(rates[0])
  const high = Math.round(rates[rates.length - 1])
  return `$${low}–${high}`
}

// Column widths for the Crew Summary table, shared by the header, every row and
// the totals row so a change can't misalign one of the three.
const col = { name: 120, role: 95, rate: 55, worked: 55, paid: 55, wot: 60, pot: 60 }

export type PdfParts = {
  Document: any; Page: any; Text: any; View: any; StyleSheet: any
}

export type PdfInput = {
  showName: string
  startDate: string
  endDate: string
  clientCompany?: string | null
  jobNumber?: string | null
  cityState?: string | null
  rooms: any[]
  workDays: any[]
  timecards: any[]
  punches: any[]
  ruleset: PayrollRuleset
  timezone: string
  showFinancials: boolean
  use24Hour?: boolean
  roundingMinutes?: number
  /** Stamped on the footer when sent as a Final Report. */
  finalizedNote?: string | null
}

export function buildReportPdf(parts: PdfParts, input: PdfInput) {
  const { Document, Page, Text, View, StyleSheet } = parts
  const {
    showName, startDate, endDate, clientCompany, jobNumber, cityState,
    rooms, workDays, timecards, punches, ruleset, timezone,
    showFinancials, use24Hour = false, roundingMinutes = 1, finalizedNote,
  } = input

  const styles = StyleSheet.create({
    page: { padding: 40, paddingBottom: 56, fontSize: 11, fontFamily: 'Helvetica' },
    title: { fontSize: 28, fontWeight: 700, marginBottom: 4 },
    subheader: { fontSize: 12, color: '#666', marginBottom: 2 },
    divider: { borderBottomWidth: 2, borderBottomColor: '#000', marginTop: 10, marginBottom: 16 },
    sectionTitle: { fontSize: 16, fontWeight: 700, marginBottom: 8, marginTop: 8 },
    summaryBox: { backgroundColor: '#f2f2f2', borderRadius: 8, padding: 12, marginBottom: 16 },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#999', paddingBottom: 4, marginBottom: 4 },
    tableHeaderText: { fontSize: 9, fontWeight: 700, color: '#666' },
    tableRow: { flexDirection: 'row', paddingVertical: 2 },
    tableCell: { fontSize: 9 },
    crewCard: { marginBottom: 14 },
    crewName: { fontSize: 13, fontWeight: 700 },
    crewRole: { fontSize: 10, color: '#666' },
    crewRate: { fontSize: 10, fontWeight: 700 },
    entryBox: { backgroundColor: '#fafafa', borderRadius: 4, padding: 8, marginBottom: 4 },
    entryRow: { flexDirection: 'row', justifyContent: 'space-between' },
    entryText: { fontSize: 9 },
    markers: { fontSize: 8, color: '#a15c00' },
    mealText: { fontSize: 8, color: '#888' },
    workedLine: { fontSize: 9, color: '#666', marginTop: 2 },
    paidLine: { fontSize: 9, fontWeight: 700, marginTop: 1 },
    payLine: { fontSize: 9, fontWeight: 700, marginTop: 1, textAlign: 'right' },
    footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
    footerText: { fontSize: 8, color: '#999' },
  })

  const toTc = (rawTc: any) => toTimecardLike(rawTc, punches)
  const allTimecards: TimecardLike[] = timecards.map(toTc)

  function timeLabel(iso: string | undefined) {
    if (!iso) return 'Missing'
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: timezone, hour12: !use24Hour,
    })
  }
  function dateLabel(dateStr: string | undefined) {
    if (!dateStr) return 'Unknown'
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    })
  }
  const longDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  let totalPaidST = 0, totalPaidOT = 0, totalPaidDT = 0, totalLaborCost = 0
  for (const rawTc of timecards) {
    const tc = toTc(rawTc)
    totalPaidST += paidStraightTimeHours(tc, allTimecards, ruleset, roundingMinutes)
    totalPaidOT += paidOvertimeHours(tc, allTimecards, ruleset, roundingMinutes)
    totalPaidDT += paidDoubleTimeHours(tc, allTimecards, ruleset, roundingMinutes)
    totalLaborCost += totalPay(tc, allTimecards, ruleset, roundingMinutes)
  }
  const totalPaidHours = totalPaidST + totalPaidOT + totalPaidDT

  // Grouped by PERSON, not by person+role — see the same change in the By Crew
  // report. Somebody who covered a different position mid-run used to appear
  // twice in the client's PDF with their hours split between the two. The
  // per-timecard maths below is unchanged; this only decides the buckets.
  const grouped: Record<string, any[]> = {}
  for (const tc of timecards) {
    const key = tc.crew_member_id || tc.crew_member_name
    ;(grouped[key] ??= []).push(tc)
  }

  const crewSummaries = Object.keys(grouped).sort().map(key => {
    const entries = grouped[key]
    let st = 0, ot = 0, dt = 0, pST = 0, pOT = 0, pDT = 0, pay = 0, travel = 0
    for (const rawTc of entries) {
      const tc = toTc(rawTc)
      st += straightTimeHours(tc, allTimecards, ruleset, roundingMinutes)
      ot += overtimeHours(tc, allTimecards, ruleset, roundingMinutes)
      dt += doubleTimeHours(tc, allTimecards, ruleset, roundingMinutes)
      pST += paidStraightTimeHours(tc, allTimecards, ruleset, roundingMinutes)
      pOT += paidOvertimeHours(tc, allTimecards, ruleset, roundingMinutes)
      pDT += paidDoubleTimeHours(tc, allTimecards, ruleset, roundingMinutes)
      pay += totalPay(tc, allTimecards, ruleset, roundingMinutes)
      travel += travelLegPay(tc, ruleset)
    }
    const rates = [...new Set(entries.map((e: any) => Number(e.day_rate) || 0))]
      .sort((a, b) => a - b)
    return {
      name: entries[0].crew_member_name,
      // Every role they held, in the order the days ran. The rates array below
      // already anticipated a group spanning more than one rate.
      role: [...new Set(entries.map((e: any) => e.role).filter(Boolean))].join(' · '),
      entries,
      st, ot, dt, worked: st + ot + dt,
      pST, pOT, pDT, paid: pST + pOT + pDT,
      pay, travel,
      rates, ratesVary: rates.length > 1,
    }
  })

  const totalWorked = crewSummaries.reduce((s, c) => s + c.worked, 0)
  const totalWorkedOT = crewSummaries.reduce((s, c) => s + c.ot, 0)

  // iOS prints these as small glyphs on the day row; spelled out here so the
  // PDF needs no icon font.
  function markersFor(rawTc: any, shortTurn: boolean): string {
    const m: string[] = []
    if (shortTurn) m.push('ST Penalty')
    if (rawTc.travel_in_day) m.push('Travel In')
    if (rawTc.travel_out_day) m.push('Travel Out')
    if (rawTc.pay_as_half_day) m.push('Half Day')
    return m.join(' · ')
  }

  const Footer = () => (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        {finalizedNote || 'Created with the CrewTracker app'}
      </Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }: any) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  )

  const subtitle = [clientCompany, jobNumber].filter(Boolean).join(' — ')

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{showName}</Text>
        {subtitle ? <Text style={styles.subheader}>{subtitle}</Text> : null}
        <Text style={styles.subheader}>
          {longDate(startDate)} – {longDate(endDate)}
          {cityState ? ` · ${cityState}` : ''}
        </Text>
        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Master Summary</Text>
        <View style={styles.summaryBox}>
          <View style={styles.summaryRow}><Text>Total Hours (Paid):</Text><Text>{fmt2(totalPaidHours)} hrs</Text></View>
          <View style={styles.summaryRow}><Text>Straight Time:</Text><Text>{fmt2(totalPaidST)} hrs</Text></View>
          <View style={styles.summaryRow}><Text>Overtime:</Text><Text>{fmt2(totalPaidOT)} hrs</Text></View>
          {totalPaidDT > 0 ? (
            <View style={styles.summaryRow}><Text>Double Time:</Text><Text>{fmt2(totalPaidDT)} hrs</Text></View>
          ) : null}
          {showFinancials ? (
            <View style={[styles.summaryRow, { marginTop: 4, borderTopWidth: 1, borderTopColor: '#ccc', paddingTop: 4 }]}>
              <Text style={{ fontWeight: 700 }}>Direct Labor Total:</Text>
              <Text style={{ fontWeight: 700 }}>${fmt2(totalLaborCost)}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Crew Summary</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, { width: col.name }]}>Name</Text>
          <Text style={[styles.tableHeaderText, { width: col.role }]}>Role</Text>
          {showFinancials ? (
            <Text style={[styles.tableHeaderText, { width: col.rate, textAlign: 'right' }]}>Day Rate</Text>
          ) : null}
          <Text style={[styles.tableHeaderText, { width: col.worked, textAlign: 'right' }]}>Worked</Text>
          <Text style={[styles.tableHeaderText, { width: col.paid, textAlign: 'right' }]}>Paid</Text>
          <Text style={[styles.tableHeaderText, { width: col.wot, textAlign: 'right' }]}>Worked OT</Text>
          <Text style={[styles.tableHeaderText, { width: col.pot, textAlign: 'right' }]}>Paid OT</Text>
        </View>
        {crewSummaries.map(c => (
          <View key={`${c.name}|${c.role}`} style={styles.tableRow}>
            <Text style={[styles.tableCell, { width: col.name }]}>{c.name}</Text>
            <Text style={[styles.tableCell, { width: col.role, color: '#666' }]}>{c.role}</Text>
            {showFinancials ? (
              <Text style={[styles.tableCell, { width: col.rate, textAlign: 'right' }]}>{rateLabel(c.rates)}</Text>
            ) : null}
            <Text style={[styles.tableCell, { width: col.worked, textAlign: 'right', color: '#666' }]}>{fmt2(c.worked)}</Text>
            <Text style={[styles.tableCell, { width: col.paid, textAlign: 'right', fontWeight: 700 }]}>{fmt2(c.paid)}</Text>
            <Text style={[styles.tableCell, { width: col.wot, textAlign: 'right', color: '#666' }]}>{fmt2(c.ot)}</Text>
            <Text style={[styles.tableCell, { width: col.pot, textAlign: 'right', fontWeight: 700 }]}>{fmt2(c.pOT)}</Text>
          </View>
        ))}
        <View style={[styles.tableRow, { borderTopWidth: 1, borderTopColor: '#000', marginTop: 4, paddingTop: 4 }]}>
          <Text style={[styles.tableCell, { width: col.name, fontWeight: 700 }]}>Totals</Text>
          <Text style={[styles.tableCell, { width: col.role }]}></Text>
          {/* No rate total — summing day rates across people is meaningless. */}
          {showFinancials ? <Text style={[styles.tableCell, { width: col.rate }]}></Text> : null}
          <Text style={[styles.tableCell, { width: col.worked, textAlign: 'right', color: '#666' }]}>{fmt2(totalWorked)}</Text>
          <Text style={[styles.tableCell, { width: col.paid, textAlign: 'right', fontWeight: 700 }]}>{fmt2(totalPaidHours)}</Text>
          <Text style={[styles.tableCell, { width: col.wot, textAlign: 'right', color: '#666' }]}>{fmt2(totalWorkedOT)}</Text>
          <Text style={[styles.tableCell, { width: col.pot, textAlign: 'right', fontWeight: 700 }]}>{fmt2(totalPaidOT)}</Text>
        </View>

        <Footer />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Crew Breakdown</Text>
        {crewSummaries.map(c => {
          const sortedEntries = [...c.entries].sort((a, b) => {
            const wdA = workDayFor(a, rooms, workDays)
            const wdB = workDayFor(b, rooms, workDays)
            return (wdA?.date || '').localeCompare(wdB?.date || '')
          })

          // Only worth repeating the rate on every day when it actually differs
          // between them — otherwise the header line above says it once.
          const showEntryRate = showFinancials && c.ratesVary

          return (
            <View key={`${c.name}|${c.role}`} style={styles.crewCard} wrap={false}>
              <View style={styles.entryRow}>
                <Text style={styles.crewName}>{c.name} <Text style={styles.crewRole}>({c.role})</Text></Text>
                {showFinancials ? (
                  <Text style={styles.crewRate}>{rateLabel(c.rates)} / day</Text>
                ) : null}
              </View>

              <View style={{ marginTop: 4 }}>
                {sortedEntries.map((rawTc: any) => {
                  const wd = workDayFor(rawTc, rooms, workDays)
                  const p = (type: string) =>
                    punches.find((pp: any) => pp.timecard_id === rawTc.id && pp.punch_type === type)?.punched_at

                  if (rawTc.absence) {
                    // Booked, did not work (0027). Hours are nil by
                    // definition; the pay (a cancellation fee, or nothing)
                    // is already in the person's total.
                    return (
                      <View key={rawTc.id} style={styles.entryBox}>
                        <View style={styles.entryRow}>
                          <Text style={styles.entryText}>
                            {dateLabel(wd?.date)} — {rawTc.absence === 'cancelled' ? 'Cancelled' : 'No-show'}
                          </Text>
                          <Text style={styles.mealText}>
                            {rawTc.absence === 'cancelled' && showEntryRate
                              ? money(totalPay(toTc(rawTc), allTimecards, ruleset, roundingMinutes))
                              : ''}
                          </Text>
                        </View>
                      </View>
                    )
                  }

                  if (rawTc.is_travel_day) {
                    return (
                      <View key={rawTc.id} style={styles.entryBox}>
                        <View style={styles.entryRow}>
                          <Text style={styles.entryText}>{dateLabel(wd?.date)} — Travel Day</Text>
                          <Text style={styles.mealText}>{ruleset.travel_rate === 'fullDay' ? 'Full Day' : 'Half Day'}</Text>
                        </View>
                        {showEntryRate ? (
                          <Text style={styles.mealText}>{money(Number(rawTc.day_rate) || 0)} / day</Text>
                        ) : null}
                      </View>
                    )
                  }

                  const tc = toTc(rawTc)
                  const dayTotal =
                    straightTimeHours(tc, allTimecards, ruleset, roundingMinutes) +
                    overtimeHours(tc, allTimecards, ruleset, roundingMinutes) +
                    doubleTimeHours(tc, allTimecards, ruleset, roundingMinutes)
                  const shortTurn = isShortTurnaround(tc, allTimecards, ruleset)
                  const marks = markersFor(rawTc, shortTurn)
                  // Every completed break, labelled by position, so a third one
                  // appears without this needing another hardcoded pair.
                  const breaks = MEAL_PAIRS
                    .map(([outType, inType], i) =>
                      p(outType) && p(inType)
                        ? `${mealLabel(i)}: ${timeLabel(p(outType))} - ${timeLabel(p(inType))}`
                        : null)
                    .filter(Boolean)

                  return (
                    <View key={rawTc.id} style={styles.entryBox}>
                      <View style={styles.entryRow}>
                        <Text style={styles.entryText}>
                          {dateLabel(wd?.date)}  In: {timeLabel(p('start'))}  Out: {timeLabel(p('end'))}
                        </Text>
                        <Text style={styles.entryText}>{fmt2(dayTotal)} hrs</Text>
                      </View>
                      {showEntryRate ? (
                        <Text style={styles.mealText}>{money(Number(rawTc.day_rate) || 0)} / day</Text>
                      ) : null}
                      {marks ? <Text style={styles.markers}>{marks}</Text> : null}
                      {breaks.length > 0 ? (
                        <Text style={styles.mealText}>{breaks.join('   ')}</Text>
                      ) : null}
                    </View>
                  )
                })}
              </View>

              <Text style={styles.workedLine}>Worked: {fmt2(c.st)} ST / {fmt2(c.ot)} OT / {fmt2(c.dt)} DT</Text>
              <Text style={styles.paidLine}>Paid: {fmt2(c.pST)} ST / {fmt2(c.pOT)} OT / {fmt2(c.pDT)} DT</Text>
              {showFinancials && c.travel > 0 ? (
                <Text style={styles.workedLine}>Travel Pay: ${fmt2(c.travel)}</Text>
              ) : null}
              {showFinancials ? (
                <Text style={styles.payLine}>Total Pay: ${fmt2(c.pay)}</Text>
              ) : null}
            </View>
          )
        })}
        <Footer />
      </Page>
    </Document>
  )
}
