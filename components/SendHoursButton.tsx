'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'

// Hands a crew member their own timesheet. iOS does this with a ShareLink and
// an sms: deep link; the web has no single equivalent, so this offers whatever
// the device actually supports:
//   Text  — sms: link, only when a phone number is on file
//   Share — Web Share API (mobile browsers + desktop Safari), not desktop Chrome
//   Copy  — clipboard, the universal fallback
//
// The text is built server-side and passed in, so this component holds no
// payroll logic.

export default function SendHoursButton({
  crewName,
  phone,
  timesheetText,
  smsMessage,
}: {
  crewName: string
  phone: string | null
  timesheetText: string
  smsMessage: string
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<'' | 'copied' | 'manual'>('')
  const preRef = useRef<HTMLPreElement>(null)
  // Capability detection MUST happen after mount. Branching on `navigator`
  // during SSR reintroduces the hydration-mismatch class CLAUDE.md documents.
  const [canShare, setCanShare] = useState(false)
  const [isApple, setIsApple] = useState(false)

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
    const ua = navigator.userAgent
    // iPadOS 13+ reports as MacIntel, hence the touch-points check.
    setIsApple(
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    )
  }, [])

  const digits = (phone || '').replace(/\D/g, '')

  function sendText() {
    // Apple's SMS handler wants `&body=`; Android and the spec want `?body=`.
    const sep = isApple ? '&' : '?'
    window.location.href = `sms:${digits}${sep}body=${encodeURIComponent(smsMessage)}`
  }

  async function share() {
    try {
      // The bare timesheet, matching iOS's ShareLink — only the SMS path adds
      // the "Hi {name}," wrapper.
      await navigator.share({ text: timesheetText })
    } catch {
      // User dismissed the share sheet — nothing to report.
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(timesheetText)
      setStatus('copied')
      setTimeout(() => setStatus(''), 2000)
    } catch {
      // The clipboard can be refused — no user activation, an unfocused
      // document, or a non-secure context. Select the text so it can be copied
      // by hand rather than leaving a button that silently did nothing.
      const el = preRef.current
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
      setStatus('manual')
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Send Hours
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-card bg-surface border border-line shadow-xl">
        <div className="p-6 pb-3 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Send Hours</h2>
          <p className="text-xs text-muted mt-1">
            {crewName}
            {digits
              ? ' · a text will open pre-addressed to them'
              : ' · no phone on file, so texting is unavailable'}
          </p>
        </div>

        {/* Mono here is deliberate: it's a column-aligned timesheet, which is
            the one case CLAUDE.md reserves monospace for. */}
        <pre ref={preRef} className="flex-1 overflow-auto px-6 py-4 text-xs text-ink font-mono whitespace-pre-wrap">
          {timesheetText}
        </pre>

        <div className="p-6 pt-3 border-t border-line flex flex-col gap-2">
          {status === 'manual' && (
            <p className="text-xs text-ot">
              Couldn&apos;t reach the clipboard — the text is selected, so press ⌘C / Ctrl-C.
            </p>
          )}
          <div className="flex gap-2">
            {digits && (
              <Button className="flex-1 py-3" onClick={sendText}>Text</Button>
            )}
            {canShare && (
              <Button variant="ghost" className="flex-1 py-3" onClick={share}>Share</Button>
            )}
            <Button variant="ghost" className="flex-1 py-3" onClick={copy}>
              {status === 'copied' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button variant="ghost" className="w-full py-2" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
