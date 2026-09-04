'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import { buildSlackList, clockUrl, clockLinkExpiry, type ClockLinkRow } from '@/lib/clockLinks'

/**
 * Crew Clock — mint the links, hand them out, revoke them.
 *
 * An admin act on the whole show, so it lives on Edit Show beside the
 * scheduler handoff rather than in the tracker header next to the punch
 * controls it has nothing to do with.
 *
 * TWO KINDS OF LINK, one table (see migration 0018):
 *  - a PERSONAL link per crew member — the normal route, handed out in bulk
 *    over Slack, bookmarkable.
 *  - one VENUE code for the show — printed as a QR for walk-ups and anyone
 *    who never got the message. It carries no identity; opening it asks you
 *    to pick a room and a name.
 */

type Crew = { crewMemberId: string; name: string }
type LinkRow = { id: string; crew_member_id: string | null; token: string; revoked_at: string | null }

export default function CrewClockPanel({
  showId,
  showName,
  showEndDate,
  timeZone,
  organizationId,
  createdBy,
  crew,
  initialLinks,
}: {
  showId: string
  showName: string
  showEndDate: string
  /** The show's own timezone — the expiry is computed in it, never the server's. */
  timeZone: string
  organizationId: string
  /** The signed-in profile minting these, recorded on every link. */
  createdBy: string
  /** Everyone staffed on this show, deduped by person. */
  crew: Crew[]
  initialLinks: LinkRow[]
}) {
  const supabase = createClient()
  const [links, setLinks] = useState<LinkRow[]>(initialLinks)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  // Read at render rather than baked in at build time, matching every auth
  // redirect in this app — so a preview deploy hands out preview links.
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const byCrew = useMemo(() => {
    const m = new Map<string, LinkRow>()
    for (const l of links) if (l.crew_member_id) m.set(l.crew_member_id, l)
    return m
  }, [links])

  const venue = links.find(l => l.crew_member_id === null) ?? null

  const rows: ClockLinkRow[] = crew.map(c => {
    const l = byCrew.get(c.crewMemberId)
    return { crewMemberId: c.crewMemberId, name: c.name, token: l?.token ?? null, revokedAt: l?.revoked_at ?? null }
  })

  const missing = rows.filter(r => !r.token)
  const liveCount = rows.filter(r => r.token && !r.revokedAt).length
  const slackText = buildSlackList(showName, rows, origin)

  /** Mint links for anyone without one, and the venue code if it's absent. */
  async function generate() {
    setBusy(true); setError(''); setStatus('')
    const wanted: { show_id: string; crew_member_id: string | null; organization_id: string; created_by: string; expires_at: string }[] =
      missing.map(m => ({
        show_id: showId,
        crew_member_id: m.crewMemberId,
        created_by: createdBy,
        // The trigger overwrites this from the show, so it cannot be used to
        // plant a row in another org — but the INSERT policy's WITH CHECK
        // tests the column, so send the real value rather than relying on
        // trigger-versus-policy ordering.
        organization_id: organizationId,
        expires_at: clockLinkExpiry(showEndDate, timeZone),
      }))
    if (!venue) {
      wanted.push({ show_id: showId, crew_member_id: null, organization_id: organizationId, created_by: createdBy, expires_at: clockLinkExpiry(showEndDate, timeZone) })
    }
    if (wanted.length === 0) { setBusy(false); return }

    // Verified write: an insert matching no policy returns success with zero
    // rows, so count what came back rather than trusting the absence of an
    // error.
    const { data, error: err } = await supabase
      .from('clock_links')
      .insert(wanted)
      .select('id, crew_member_id, token, revoked_at')

    if (err) setError(err.message)
    else if (!data || data.length !== wanted.length) {
      setError(`Only ${data?.length ?? 0} of ${wanted.length} links were created. You may not have permission to do this.`)
      if (data?.length) setLinks(prev => [...prev, ...data])
    } else {
      setLinks(prev => [...prev, ...data])
      setStatus(`Created ${data.length} link${data.length === 1 ? '' : 's'}.`)
    }
    setBusy(false)
  }

  /** Revoking keeps the row, so punches already made through it stay traceable. */
  async function revoke(id: string) {
    setBusy(true); setError(''); setStatus('')
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('clock_links').update({ revoked_at: now }).eq('id', id).select('id')
    if (err) setError(err.message)
    else if (!data || data.length === 0) setError('That link was not revoked — you may not have permission.')
    else setLinks(prev => prev.map(l => (l.id === id ? { ...l, revoked_at: now } : l)))
    setBusy(false)
  }

  /** A revoked link is replaced with a fresh token, never un-revoked. */
  async function reissue(crewMemberId: string | null, oldId: string) {
    setBusy(true); setError(''); setStatus('')
    const del = await supabase.from('clock_links').delete().eq('id', oldId).select('id')
    if (del.error) { setError(del.error.message); setBusy(false); return }
    const { data, error: err } = await supabase
      .from('clock_links')
      .insert({ show_id: showId, crew_member_id: crewMemberId, organization_id: organizationId, created_by: createdBy, expires_at: clockLinkExpiry(showEndDate, timeZone) })
      .select('id, crew_member_id, token, revoked_at')
      .single()
    if (err || !data) setError(err?.message ?? 'Could not reissue that link.')
    else setLinks(prev => [...prev.filter(l => l.id !== oldId), data])
    setBusy(false)
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setStatus(label); setTimeout(() => setStatus(''), 2000)
    } catch {
      // Refused: no user activation, an unfocused document, or a non-secure
      // context. Reveal the block and select it rather than leaving a button
      // that silently did nothing.
      setListOpen(true)
      setTimeout(() => {
        const el = preRef.current
        if (!el) return
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges(); sel?.addRange(range)
        setStatus('Couldn’t reach the clipboard — the list is selected, so press ⌘C / Ctrl-C.')
      }, 0)
    }
  }

  return (
    <section className="mb-6">
      <p className="mb-3 border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">
        Crew Clock
      </p>

      <p className="text-xs text-muted mb-3">
        Give crew a link to punch themselves in and out — no login needed. Their times land on the
        tracker straight away, marked as crew-entered, and you review everything before you send
        the final report.
      </p>

      {crew.length === 0 ? (
        <p className="text-sm text-muted">Nobody is staffed on this show yet. Add crew first, then come back.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {missing.length > 0 && (
              <Button size="sm" onClick={generate} disabled={busy}>
                {links.length === 0 ? 'Create links' : `Create ${missing.length} missing link${missing.length === 1 ? '' : 's'}`}
              </Button>
            )}
            {liveCount > 0 && (
              <>
                <Button variant="ghost" size="sm" onClick={() => copy(slackText, 'List copied.')} disabled={busy}>
                  Copy list for Slack
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setListOpen(o => !o)}>
                  {listOpen ? 'Hide list' : 'Show list'}
                </Button>
              </>
            )}
            {venue && !venue.revoked_at && (
              <a
                href={`/dashboard/shows/${showId}/clock/print`}
                target="_blank"
                rel="noreferrer"
                className="border-2 border-ink px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink hover:bg-surface-2"
              >
                Print QR sign
              </a>
            )}
          </div>

          {error && <p className="text-sm text-danger mb-2">{error}</p>}
          {status && <p className="text-sm text-good mb-2">{status}</p>}

          {listOpen && (
            <pre ref={preRef} className="mb-3 max-h-64 overflow-auto border border-line bg-surface-2 p-3 text-xs text-ink font-mono whitespace-pre-wrap">
              {slackText}
            </pre>
          )}

          {liveCount > 0 && (
            <p className="text-xs text-muted mb-3">
              Pasting the whole list into a channel means everyone in it can see everyone&apos;s link.
              Use the per-person copy below if you&apos;d rather send them individually.
            </p>
          )}

          <div className="border-t-[3px] border-ink">
            {rows.map(r => {
              const row = byCrew.get(r.crewMemberId)
              return (
                <div key={r.crewMemberId} className="flex items-center gap-3 border-b border-line py-2">
                  <span className="flex-1 min-w-0 truncate text-sm text-ink">{r.name}</span>
                  {!r.token ? (
                    <span className="text-xs text-muted">No link</span>
                  ) : r.revokedAt ? (
                    <>
                      <span className="text-xs text-ot">Revoked</span>
                      <button
                        className="text-xs font-semibold uppercase tracking-wide text-accent disabled:opacity-50"
                        onClick={() => reissue(r.crewMemberId, row!.id)}
                        disabled={busy}
                      >
                        Reissue
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="text-xs font-semibold uppercase tracking-wide text-accent disabled:opacity-50"
                        onClick={() => copy(clockUrl(origin, r.token!), `Copied ${r.name}’s link.`)}
                        disabled={busy}
                      >
                        Copy
                      </button>
                      <button
                        className="text-xs font-semibold uppercase tracking-wide text-muted hover:text-danger disabled:opacity-50"
                        onClick={() => revoke(row!.id)}
                        disabled={busy}
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {venue && (
            <p className="text-xs text-muted mt-3">
              {venue.revoked_at
                ? 'The venue QR has been revoked. '
                : 'A venue QR also exists for this show — print it for walk-ups and anyone who never got the message. '}
              {venue.revoked_at && (
                <button className="font-semibold uppercase tracking-wide text-accent" onClick={() => reissue(null, venue.id)} disabled={busy}>
                  Reissue it
                </button>
              )}
            </p>
          )}
        </>
      )}
    </section>
  )
}
