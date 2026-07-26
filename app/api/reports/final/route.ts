import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildReportCsv } from '@/lib/reportCsv'
import { buildReportPdf } from '@/lib/reportPdf'

// The Final Report: a PM signs off that times are locked and the complete
// payroll report — INCLUDING financials — goes to the addresses an admin
// designated, WITHOUT the PM ever seeing the figures.
//
// That last constraint drives the whole shape of this route:
//   * It accepts ONLY a show id. Recipients are read server-side from the org.
//     If the client could supply them, a PM could mail the financials to
//     themselves, which defeats the entire feature.
//   * Documents are rendered here, never in the browser, so the numbers never
//     pass through the PM's client.
//   * The response is a bare count. No totals, no preview, no attachment
//     echoed back — anything richer leaks what the PM isn't meant to see.
//   * Authorises on can_send_reports and deliberately NOT on
//     can_view_pay_rates.
//
// Known limitation, tracked separately: `authenticated` still holds column
// SELECT on timecards.day_rate, so a determined PM could read rates from the
// REST API directly. This route closes the reporting path, not that one.

const FROM = 'CrewTracker Reports <reports@contact.crewtracker.app>'

function parseRecipients(raw: string | null | undefined): string[] {
  if (!raw) return []
  return [...new Set(
    raw.split(',').map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
  )]
}

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const showId = typeof body?.showId === 'string' ? body.showId : null
  if (!showId) {
    return NextResponse.json({ error: 'A show id is required.' }, { status: 400 })
  }

  // --- Who is asking, and may they? -----------------------------------------
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, full_name, can_send_reports')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'No organization on this account.' }, { status: 403 })
  }
  if (!profile.can_send_reports) {
    return NextResponse.json({ error: 'You do not have permission to send reports.' }, { status: 403 })
  }

  // --- Everything below runs as the service role ----------------------------
  // so the documents don't depend on the caller's RLS view.
  const admin = createAdminClient()

  const { data: show } = await admin.from('shows').select('*').eq('id', showId).single()
  if (!show) {
    return NextResponse.json({ error: 'Show not found.' }, { status: 404 })
  }
  // Scope check is explicit precisely because the service role bypasses RLS.
  if (show.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Show not found.' }, { status: 404 })
  }
  if (show.finalized_at) {
    return NextResponse.json(
      { error: 'This show has already been finalized. An admin can unlock it to send again.' },
      { status: 409 },
    )
  }

  const { data: org } = await admin
    .from('organizations')
    .select('final_report_emails')
    .eq('id', profile.organization_id)
    .single()

  const recipients = parseRecipients(org?.final_report_emails)
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'No final-report recipients are configured. An admin can set them in Settings.' },
      { status: 400 },
    )
  }

  // --- Gather the show ------------------------------------------------------
  const { data: ruleset } = await admin
    .from('payroll_rulesets').select('*').eq('show_id', showId).single()
  if (!ruleset) {
    return NextResponse.json({ error: 'This show has no payroll ruleset.' }, { status: 400 })
  }

  const { data: workDays } = await admin
    .from('work_days').select('id, date, day_number').eq('show_id', showId).order('day_number')
  const workDayIds = (workDays || []).map(d => d.id)

  const { data: rooms } = workDayIds.length
    ? await admin.from('rooms').select('id, name, work_day_id').in('work_day_id', workDayIds).order('created_at')
    : { data: [] as any[] }
  const roomIds = (rooms || []).map(r => r.id)

  const { data: timecards } = roomIds.length
    ? await admin.from('timecards').select('*').in('room_id', roomIds)
    : { data: [] as any[] }
  const timecardIds = (timecards || []).map(t => t.id)

  const { data: punches } = timecardIds.length
    ? await admin.from('punches').select('*').in('timecard_id', timecardIds)
    : { data: [] as any[] }

  const timezone = show.timezone_identifier || 'America/Chicago'
  const { data: orgRounding } = await admin
    .from('organizations').select('timecard_rounding_minutes').eq('id', profile.organization_id).single()
  const roundingMinutes = orgRounding?.timecard_rounding_minutes ?? 1

  const reportData = {
    rooms: rooms || [],
    workDays: workDays || [],
    timecards: timecards || [],
    punches: punches || [],
    ruleset,
    timezone,
    // The SHOW decides whether there are dollars to report. The caller's
    // can_view_pay_rates deliberately does not.
    showFinancials: show.show_financials || false,
    roundingMinutes,
  }

  // --- Render ---------------------------------------------------------------
  const sentAt = new Date()
  const finalizedNote =
    `Final report · times locked ${sentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: timezone })}` +
    (profile.full_name ? ` by ${profile.full_name}` : '')

  let csv: string
  let pdfBuffer: Buffer
  try {
    csv = buildReportCsv(reportData)

    const { Document, Page, Text, View, StyleSheet, renderToBuffer } = await import('@react-pdf/renderer')
    const doc = buildReportPdf({ Document, Page, Text, View, StyleSheet }, {
      showName: show.name,
      startDate: show.start_date,
      endDate: show.end_date,
      clientCompany: show.client_company,
      jobNumber: show.job_number,
      cityState: show.city_state,
      finalizedNote,
      ...reportData,
    })
    pdfBuffer = await renderToBuffer(doc as any)
  } catch (err) {
    console.error('final-report: document generation failed', err)
    return NextResponse.json({ error: 'Could not generate the report documents.' }, { status: 500 })
  }

  // --- Send ----------------------------------------------------------------
  const safeName = show.name.replace(/[^\w.-]+/g, '_')
  const resend = new Resend(process.env.RESEND_API_KEY)
  try {
    const { error: sendError } = await resend.emails.send({
      from: FROM,
      // All recipients in To: so each can see who else received it.
      to: recipients,
      subject: `Final Payroll Report: ${show.name}`,
      text: [
        `${show.name}`,
        [show.client_company, show.job_number].filter(Boolean).join(' — '),
        `${show.start_date} to ${show.end_date}${show.city_state ? ` · ${show.city_state}` : ''}`,
        '',
        'Times are locked. Attached are the payroll timesheets (PDF) and the payroll data (CSV).',
        '',
        finalizedNote,
        '',
        'Created with the CrewTracker app',
      ].filter(l => l !== undefined).join('\n'),
      attachments: [
        { filename: `${safeName}_Report.pdf`, content: pdfBuffer.toString('base64') },
        { filename: `${safeName}_Payroll.csv`, content: Buffer.from(csv, 'utf8').toString('base64') },
      ],
    })
    if (sendError) {
      console.error('final-report: Resend rejected the send', sendError)
      return NextResponse.json({ error: 'The email could not be sent.' }, { status: 502 })
    }
  } catch (err) {
    console.error('final-report: Resend send threw', err)
    return NextResponse.json({ error: 'The email could not be sent.' }, { status: 502 })
  }

  // --- Lock the show -------------------------------------------------------
  // Only after a successful send, so a delivery failure never locks a show.
  const { error: lockError } = await admin
    .from('shows')
    .update({
      finalized_at: sentAt.toISOString(),
      finalized_by: user.id,
      final_report_recipients: recipients.join(', '),
    })
    .eq('id', showId)

  if (lockError) {
    console.error('final-report: sent but failed to lock', lockError)
    return NextResponse.json(
      { ok: true, sent: recipients.length, warning: 'Report sent, but the show could not be locked.' },
    )
  }

  // Deliberately bare: a count only, never any figure from the report.
  return NextResponse.json({ ok: true, sent: recipients.length })
}
