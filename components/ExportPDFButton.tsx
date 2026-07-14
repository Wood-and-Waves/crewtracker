'use client'

import { useState } from 'react'
import {
  straightTimeHours, overtimeHours, doubleTimeHours,
  paidStraightTimeHours, paidOvertimeHours, paidDoubleTimeHours,
  travelLegPay, totalPay,
  TimecardLike, PayrollRuleset,
} from '@/lib/payroll'

function fmt2(n: number): string {
  return n.toFixed(2)
}

export default function ExportPDFButton({
  showName,
  startDate,
  endDate,
  rooms,
  workDays,
  timecards,
  punches,
  ruleset,
  timezone,
}: {
  showName: string
  startDate: string
  endDate: string
  rooms: any[]
  workDays: any[]
  timecards: any[]
  punches: any[]
  ruleset: PayrollRuleset
  timezone: string
}) {
  const [generating, setGenerating] = useState(false)

  function toTc(rawTc: any): TimecardLike {
    return {
      id: rawTc.id,
      crew_member_id: rawTc.crew_member_id,
      day_rate: rawTc.day_rate,
      is_travel_day: rawTc.is_travel_day,
      travel_in_day: rawTc.travel_in_day,
      travel_out_day: rawTc.travel_out_day,
      pay_as_half_day: rawTc.pay_as_half_day,
      punches: punches.filter((p: any) => p.timecard_id === rawTc.id),
    }
  }

  function timeLabel(iso: string | undefined) {
    if (!iso) return 'Missing'
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone })
  }

  function dateLabel(dateStr: string | undefined) {
    if (!dateStr) return 'Unknown'
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  async function generatePDF() {
    setGenerating(true)
    try {
      const { Document, Page, Text, View, StyleSheet, pdf } = await import('@react-pdf/renderer')

      const styles = StyleSheet.create({
        page: { padding: 40, fontSize: 11, fontFamily: 'Helvetica' },
        title: { fontSize: 28, fontWeight: 700, marginBottom: 4 },
        subheader: { fontSize: 12, color: '#666', marginBottom: 12 },
        divider: { borderBottomWidth: 2, borderBottomColor: '#000', marginBottom: 16 },
        sectionTitle: { fontSize: 16, fontWeight: 700, marginBottom: 8, marginTop: 8 },
        summaryBox: { backgroundColor: '#f2f2f2', borderRadius: 8, padding: 12, marginBottom: 16 },
        summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
        tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#999', paddingBottom: 4, marginBottom: 4 },
        tableHeaderText: { fontSize: 9, fontWeight: 700, color: '#666' },
        tableRow: { flexDirection: 'row', paddingVertical: 2 },
        tableCell: { fontSize: 9 },
        crewCard: { marginBottom: 14 },
        crewName: { fontSize: 13, fontWeight: 700 },
        crewRole: { fontSize: 10, color: '#666', marginBottom: 4 },
        entryBox: { backgroundColor: '#fafafa', borderRadius: 4, padding: 8, marginBottom: 4 },
        entryRow: { flexDirection: 'row', justifyContent: 'space-between' },
        entryText: { fontSize: 9 },
        mealText: { fontSize: 8, color: '#888' },
        workedLine: { fontSize: 9, color: '#666', marginTop: 2 },
        paidLine: { fontSize: 9, fontWeight: 700, marginTop: 1 },
        footer: { fontSize: 8, color: '#999', textAlign: 'center', marginTop: 20 },
      })

      const allTimecards: TimecardLike[] = timecards.map(toTc)

      let totalPaidST = 0, totalPaidOT = 0, totalPaidDT = 0, totalLaborCost = 0
      for (const rawTc of timecards) {
        const tc = toTc(rawTc)
        totalPaidST += paidStraightTimeHours(tc, allTimecards, ruleset)
        totalPaidOT += paidOvertimeHours(tc, allTimecards, ruleset)
        totalPaidDT += paidDoubleTimeHours(tc, allTimecards, ruleset)
        totalLaborCost += totalPay(tc, allTimecards, ruleset)
      }
      const totalPaidHours = totalPaidST + totalPaidOT + totalPaidDT

      const grouped: Record<string, any[]> = {}
      for (const tc of timecards) {
        const key = `${tc.crew_member_name}|${tc.role}`
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(tc)
      }

      const crewSummaries = Object.keys(grouped).sort().map(key => {
        const entries = grouped[key]
        let st = 0, ot = 0, dt = 0, pST = 0, pOT = 0, pDT = 0
        for (const rawTc of entries) {
          const tc = toTc(rawTc)
          st += straightTimeHours(tc, allTimecards, ruleset)
          ot += overtimeHours(tc, allTimecards, ruleset)
          dt += doubleTimeHours(tc, allTimecards, ruleset)
          pST += paidStraightTimeHours(tc, allTimecards, ruleset)
          pOT += paidOvertimeHours(tc, allTimecards, ruleset)
          pDT += paidDoubleTimeHours(tc, allTimecards, ruleset)
        }
        return {
          name: entries[0].crew_member_name,
          role: entries[0].role,
          entries,
          st, ot, dt, worked: st + ot + dt,
          pST, pOT, pDT, paid: pST + pOT + pDT,
        }
      })

      const totalWorked = crewSummaries.reduce((s, c) => s + c.worked, 0)
      const totalWorkedOT = crewSummaries.reduce((s, c) => s + c.ot, 0)

      const doc = (
        <Document>
          <Page size="LETTER" style={styles.page}>
            <Text style={styles.title}>{showName}</Text>
            <Text style={styles.subheader}>
              {new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {' '}–{' '}
              {new Date(endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
            <View style={styles.divider} />

            <Text style={styles.sectionTitle}>Master Summary</Text>
            <View style={styles.summaryBox}>
              <View style={styles.summaryRow}><Text>Total Hours (Paid):</Text><Text>{fmt2(totalPaidHours)} hrs</Text></View>
              <View style={styles.summaryRow}><Text>Straight Time:</Text><Text>{fmt2(totalPaidST)} hrs</Text></View>
              <View style={styles.summaryRow}><Text>Overtime:</Text><Text>{fmt2(totalPaidOT)} hrs</Text></View>
              {totalPaidDT > 0 && <View style={styles.summaryRow}><Text>Double Time:</Text><Text>{fmt2(totalPaidDT)} hrs</Text></View>}
              <View style={[styles.summaryRow, { marginTop: 4, borderTopWidth: 1, borderTopColor: '#ccc', paddingTop: 4 }]}>
                <Text style={{ fontWeight: 700 }}>Direct Labor Total:</Text>
                <Text style={{ fontWeight: 700 }}>${fmt2(totalLaborCost)}</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Crew Summary</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, { width: 130 }]}>Name</Text>
              <Text style={[styles.tableHeaderText, { width: 100 }]}>Role</Text>
              <Text style={[styles.tableHeaderText, { width: 55, textAlign: 'right' }]}>Worked</Text>
              <Text style={[styles.tableHeaderText, { width: 55, textAlign: 'right' }]}>Paid</Text>
              <Text style={[styles.tableHeaderText, { width: 60, textAlign: 'right' }]}>Worked OT</Text>
              <Text style={[styles.tableHeaderText, { width: 60, textAlign: 'right' }]}>Paid OT</Text>
            </View>
            {crewSummaries.map(c => (
              <View key={c.name} style={styles.tableRow}>
                <Text style={[styles.tableCell, { width: 130 }]}>{c.name}</Text>
                <Text style={[styles.tableCell, { width: 100, color: '#666' }]}>{c.role}</Text>
                <Text style={[styles.tableCell, { width: 55, textAlign: 'right', color: '#666' }]}>{fmt2(c.worked)}</Text>
                <Text style={[styles.tableCell, { width: 55, textAlign: 'right', fontWeight: 700 }]}>{fmt2(c.paid)}</Text>
                <Text style={[styles.tableCell, { width: 60, textAlign: 'right', color: '#666' }]}>{fmt2(c.ot)}</Text>
                <Text style={[styles.tableCell, { width: 60, textAlign: 'right', fontWeight: 700 }]}>{fmt2(c.pOT)}</Text>
              </View>
            ))}
            <View style={[styles.tableRow, { borderTopWidth: 1, borderTopColor: '#000', marginTop: 4, paddingTop: 4 }]}>
              <Text style={[styles.tableCell, { width: 130, fontWeight: 700 }]}>Totals</Text>
              <Text style={[styles.tableCell, { width: 100 }]}></Text>
              <Text style={[styles.tableCell, { width: 55, textAlign: 'right', color: '#666' }]}>{fmt2(totalWorked)}</Text>
              <Text style={[styles.tableCell, { width: 55, textAlign: 'right', fontWeight: 700 }]}>{fmt2(totalPaidHours)}</Text>
              <Text style={[styles.tableCell, { width: 60, textAlign: 'right', color: '#666' }]}>{fmt2(totalWorkedOT)}</Text>
              <Text style={[styles.tableCell, { width: 60, textAlign: 'right', fontWeight: 700 }]}>{fmt2(totalPaidOT)}</Text>
            </View>

            <Text style={styles.footer}>Created with the CrewTracker app</Text>
          </Page>

          <Page size="LETTER" style={styles.page}>
            <Text style={styles.sectionTitle}>Crew Breakdown</Text>
            {crewSummaries.map(c => {
              const travelPay = c.entries.reduce((s: number, rawTc: any) => s + travelLegPay(toTc(rawTc), ruleset), 0)
              const sortedEntries = [...c.entries].sort((a, b) => {
                const wdA = workDays.find(d => rooms.find(r => r.id === a.room_id)?.work_day_id === d.id)
                const wdB = workDays.find(d => rooms.find(r => r.id === b.room_id)?.work_day_id === d.id)
                return (wdA?.date || '').localeCompare(wdB?.date || '')
              })

              return (
                <View key={c.name} style={styles.crewCard} wrap={false}>
                  <Text style={styles.crewName}>{c.name} <Text style={styles.crewRole}>({c.role})</Text></Text>

                  <View style={{ marginTop: 4 }}>
                    {sortedEntries.map((rawTc: any) => {
                      const wd = workDays.find(d => rooms.find(r => r.id === rawTc.room_id)?.work_day_id === d.id)
                      const p = (type: string) => punches.find((pp: any) => pp.timecard_id === rawTc.id && pp.punch_type === type)?.punched_at

                      if (rawTc.is_travel_day) {
                        return (
                          <View key={rawTc.id} style={styles.entryBox}>
                            <View style={styles.entryRow}>
                              <Text style={styles.entryText}>{dateLabel(wd?.date)} — Travel Day</Text>
                              <Text style={styles.mealText}>{ruleset.travel_rate === 'fullDay' ? 'Full Day' : 'Half Day'}</Text>
                            </View>
                          </View>
                        )
                      }

                      const tc = toTc(rawTc)
                      const dayTotal = straightTimeHours(tc, allTimecards, ruleset) + overtimeHours(tc, allTimecards, ruleset) + doubleTimeHours(tc, allTimecards, ruleset)
                      const m1 = p('meal_out') && p('meal_in')
                      const m2 = p('meal2_out') && p('meal2_in')

                      return (
                        <View key={rawTc.id} style={styles.entryBox}>
                          <View style={styles.entryRow}>
                            <Text style={styles.entryText}>
                              {dateLabel(wd?.date)}  In: {timeLabel(p('start'))}  Out: {timeLabel(p('end'))}
                            </Text>
                            <Text style={styles.entryText}>{fmt2(dayTotal)} hrs</Text>
                          </View>
                          {(m1 || m2) && (
                            <Text style={styles.mealText}>
                              {m1 ? `M1: ${timeLabel(p('meal_out'))} - ${timeLabel(p('meal_in'))}  ` : ''}
                              {m2 ? `M2: ${timeLabel(p('meal2_out'))} - ${timeLabel(p('meal2_in'))}` : ''}
                            </Text>
                          )}
                        </View>
                      )
                    })}
                  </View>

                  <Text style={styles.workedLine}>Worked: {fmt2(c.st)} ST / {fmt2(c.ot)} OT / {fmt2(c.dt)} DT</Text>
                  <Text style={styles.paidLine}>Paid: {fmt2(c.pST)} ST / {fmt2(c.pOT)} OT / {fmt2(c.pDT)} DT</Text>
                  {travelPay > 0 && <Text style={styles.workedLine}>Travel Pay: ${fmt2(travelPay)}</Text>}
                </View>
              )
            })}
            <Text style={styles.footer}>Created with the CrewTracker app</Text>
          </Page>
        </Document>
      )

      const blob = await pdf(doc).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${showName.replace(/ /g, '_')}_Report.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <button onClick={generatePDF} disabled={generating} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50">
      {generating ? 'Generating...' : 'Export PDF'}
    </button>
  )
}
