'use client'

import { buildReportCsv } from '@/lib/reportCsv'
import type { PayrollRuleset } from '@/lib/payroll'

// Thin wrapper: the document itself is built by lib/reportCsv so the browser
// download and the server-side Final Report email produce the same bytes.

export default function ExportCSVButton({
  showName,
  showFinancials,
  rooms,
  workDays,
  timecards,
  punches,
  ruleset,
  timezone,
  use24Hour = false,
  roundingMinutes = 1,
}: {
  showName: string
  rooms: any[]
  workDays: any[]
  timecards: any[]
  punches: any[]
  ruleset: PayrollRuleset
  timezone: string
  showFinancials: boolean
  use24Hour?: boolean
  roundingMinutes?: number
}) {
  function exportCSV() {
    const csv = buildReportCsv({
      rooms, workDays, timecards, punches, ruleset,
      timezone, showFinancials, use24Hour, roundingMinutes,
    })
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${showName.replace(/ /g, '_')}_Payroll.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button onClick={exportCSV} className="rounded-field bg-surface-2 border border-line px-4 py-2 text-sm text-ink hover:border-accent hover:text-accent">
      Export CSV
    </button>
  )
}
