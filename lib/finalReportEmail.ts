// The Final Report email — the one that carries the payroll numbers out.
//
// Extracted from app/api/reports/final/route.ts on 2026-09-09 so it can be
// read and previewed like every other message this app sends. It was written
// inline in the route, which is exactly why it went a year without an HTML
// version while every booking request looked designed.
//
// The route still owns the attachments, the recipients and the locking; this
// module owns only the words.
//
// "Sent from CrewTracker.app": a person pressed Send Final Report. See
// lib/sendEmail.ts for the other half of that rule.

export type FinalReportEmailInput = {
  showName: string
  clientCompany: string | null
  jobNumber: string | null
  cityState: string | null
  /** Already formatted, e.g. "Sep 15–20" — use describeShowDates(). */
  dates: string
  /** "Final report · times locked Sep 21, 2026 by Dan Smith" — the same string
   *  printed inside the PDF, so the two cannot disagree. */
  finalizedNote: string
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildFinalReportEmail(input: FinalReportEmailInput) {
  const subject = `Final Payroll Report: ${input.showName}`
  const subtitle = [input.clientCompany, input.jobNumber].filter(Boolean).join(' — ')
  const where = input.cityState ? ` · ${input.cityState}` : ''

  const text = [
    input.showName,
    subtitle,
    `${input.dates}${where}`,
    '',
    'This show is closed out and its times are final. Attached are the payroll',
    'timesheets (PDF) and the payroll data (CSV).',
    '',
    `${input.finalizedNote}.`,
    '',
    'Sent from CrewTracker.app',
  ].filter(l => l !== '').join('\n')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
  <p style="font-size:19px;font-weight:700;margin:0 0 4px">${escapeHtml(input.showName)}</p>
  ${subtitle ? `<p style="font-size:14px;color:#52525b;margin:0 0 2px">${escapeHtml(subtitle)}</p>` : ''}
  <p style="font-size:14px;color:#52525b;margin:0 0 20px">${escapeHtml(input.dates)}${escapeHtml(where)}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
    This show is closed out and its times are final. Attached are the payroll timesheets (PDF) and
    the payroll data (CSV).
  </p>
  <p style="font-size:14px;color:#52525b;margin:0 0 24px">${escapeHtml(input.finalizedNote)}.</p>
  <p style="font-size:12px;color:#a1a1aa;margin:0">Sent from CrewTracker.app</p>
</div>`.trim()

  return { subject, text, html }
}
