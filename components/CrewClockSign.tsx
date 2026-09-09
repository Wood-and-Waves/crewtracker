'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { clockUrl } from '@/lib/clockLinks'

/**
 * The printable venue sign.
 *
 * The QR is generated in the BROWSER, from window.location.origin, for the
 * same reason every auth redirect in this app is: it pins the printed code to
 * the origin the PM is actually using, so a preview deploy prints preview
 * links. Building it server-side would mean trusting the Host header, which is
 * attacker-controlled and already a known wart in the decline email.
 *
 * The SVG string is injected because @svg-in-react has no better option here;
 * the input is a UUID of our own minting, never user text.
 */
/** "10/1/2026 -- 10/7/2026", or one date when the show is a single day. */
function signDates(start: string, end: string) {
  const fmt = (d: string) => {
    // Bare 'YYYY-MM-DD' + T00:00:00 is LOCAL midnight. Parsing the date alone
    // gives UTC midnight, which prints as the day before west of Greenwich —
    // the trap every other date in this app guards against.
    const x = new Date(d + 'T00:00:00')
    return `${x.getMonth() + 1}/${x.getDate()}/${x.getFullYear()}`
  }
  return start === end ? fmt(start) : `${fmt(start)} -- ${fmt(end)}`
}

export default function CrewClockSign({
  token,
  showName,
  venue,
  startDate,
  endDate,
}: {
  token: string
  showName: string
  venue: string | null
  /** The run, printed under the venue so a sign left on a wall from last month
   *  is obviously not this month's (Dan, 2026-09-09). Plain numeric dates:
   *  this is read across a loading dock, not in a document. */
  startDate: string
  endDate: string
}) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    const u = clockUrl(window.location.origin, token)
    // High correction: this gets printed, taped to a road case, and scanned in
    // bad light by fifty different phones.
    QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'H' })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [token])

  return (
    <div className="mx-auto max-w-lg px-6 py-10 text-center">
      <button
        onClick={() => window.print()}
        className="mb-8 border-2 border-ink px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink hover:bg-surface-2 print:hidden"
      >
        Print this sheet
      </button>

      <p className="font-display text-[13px] font-semibold uppercase tracking-[0.15em] text-muted">
        Clock in &amp; out
      </p>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase tracking-tight text-ink">{showName}</h1>
      {venue && <p className="mt-1 text-sm text-muted">{venue}</p>}
      <p className="mt-1 text-sm text-muted">{signDates(startDate, endDate)}</p>

      <div className="mx-auto my-8 w-64 border-2 border-ink bg-white p-4">
        {svg
          ? <div className="[&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          : <div className="aspect-square animate-pulse bg-surface-2" />}
      </div>

      <p className="text-sm font-semibold text-ink">Scan this, then pick your room and your name.</p>
      <p className="mt-2 text-xs text-muted">No login needed.</p>

    </div>
  )
}
