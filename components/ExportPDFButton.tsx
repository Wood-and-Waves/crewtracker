'use client'

import { useState } from 'react'
import { buildReportPdf } from '@/lib/reportPdf'
import type { PayrollRuleset } from '@/lib/payroll'

// Thin wrapper: the document is built by lib/reportPdf so the browser download
// and the server-side Final Report email render the same PDF. @react-pdf is
// imported here (dynamically, it's heavy) and handed to the builder.

export default function ExportPDFButton({
  showName,
  showFinancials,
  startDate,
  endDate,
  clientCompany,
  jobNumber,
  cityState,
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
  showFinancials: boolean
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
  use24Hour?: boolean
  roundingMinutes?: number
}) {
  const [generating, setGenerating] = useState(false)

  async function generatePDF() {
    setGenerating(true)
    try {
      const { Document, Page, Text, View, StyleSheet, pdf } = await import('@react-pdf/renderer')
      const doc = buildReportPdf(
        { Document, Page, Text, View, StyleSheet },
        {
          showName, startDate, endDate, clientCompany, jobNumber, cityState,
          rooms, workDays, timecards, punches, ruleset, timezone,
          showFinancials, use24Hour, roundingMinutes,
        },
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
    <button onClick={generatePDF} disabled={generating} className="rounded-field bg-surface-2 border border-line px-4 py-2 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-50">
      {generating ? 'Generating...' : 'Export PDF'}
    </button>
  )
}
