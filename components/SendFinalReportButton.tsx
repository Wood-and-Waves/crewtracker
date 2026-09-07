'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'

// The PM's end-of-show sign-off. Everything of substance happens in
// /api/reports/final: this component sends nothing but a show id and shows
// nothing but a count back, because the PM is not meant to see the figures.
//
// The pre-send checks are deliberately NON-FINANCIAL. The PM is asserting that
// times are complete, so they get told what looks incomplete — never an amount.

export type PreSendIssue = { label: string; detail: string }

export default function SendFinalReportButton({
  showId,
  showName,
  recipientCount,
  issues,
}: {
  showId: string
  showName: string
  /** How many addresses an admin has configured. 0 disables sending. */
  recipientCount: number
  issues: PreSendIssue[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState<number | null>(null)

  async function send() {
    setBusy(true)
    setError('')
    try {
      // Only the show id crosses the wire. Recipients come from org settings,
      // server-side.
      const res = await fetch('/api/reports/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error || `Send failed (${res.status}).`)
        return
      }
      setSentTo(body?.sent ?? recipientCount)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { setOpen(true); setError(''); setSentTo(null) }}>
        Send Final Report
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto border-2 border-ink bg-surface p-6 shadow-edge">
        {sentTo !== null ? (
          <>
            <h2 className="text-lg font-bold text-ink mb-2">Final report sent</h2>
            <p className="text-sm text-muted mb-5">
              Sent to {sentTo} {sentTo === 1 ? 'recipient' : 'recipients'}. This show&apos;s times are
              now locked — an admin or the show’s PM can unlock it if a correction is needed.
            </p>
            <Button className="w-full py-3" onClick={() => setOpen(false)}>Done</Button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-ink mb-1">Send Final Report</h2>
            <p className="text-sm text-muted mb-4">
              Signs off <span className="text-ink">{showName}</span> as complete and emails the full
              payroll report to the {recipientCount} {recipientCount === 1 ? 'address' : 'addresses'} an
              admin has configured. This locks the show.
            </p>

            {recipientCount === 0 && (
              <p className="text-xs text-danger mb-4">
                No recipients are configured. An admin needs to set them in Settings first.
              </p>
            )}

            {issues.length > 0 && (
              <div className="rounded-field bg-surface-2 p-3 mb-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ot mb-2">
                  Check before signing off
                </p>
                <ul className="text-xs text-muted space-y-1">
                  {issues.map((i, n) => (
                    <li key={n}>
                      <span className="text-ink">{i.label}</span> — {i.detail}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted mt-2">
                  You can still send; these are just things that look unfinished.
                </p>
              </div>
            )}

            {issues.length === 0 && (
              <p className="text-xs text-good mb-4">
                Every crew member has a start and a wrap punch, and no room is empty.
              </p>
            )}

            {error && <p className="text-xs text-danger mb-3">{error}</p>}

            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1 py-3" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                className="flex-1 py-3"
                onClick={send}
                disabled={busy || recipientCount === 0}
              >
                {busy ? 'Sending…' : 'Send & Lock'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
