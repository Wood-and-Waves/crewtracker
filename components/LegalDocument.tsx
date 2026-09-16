// The markdown these documents are written in, rendered — no library, because
// they use six things and a dependency for six things is a dependency to keep
// up to date forever.
//
// Supports exactly what lib/legalDocs.ts contains: headings, paragraphs,
// **bold**, `code`, - bullets, | tables |, and > blockquotes (which is how each
// document carries its DRAFT warning). Anything else renders as plain text,
// which is the right failure: a legal page that silently drops a clause would
// be much worse than one that shows a stray asterisk.

import { Fragment, type ReactNode } from 'react'

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Bold and code, in one pass so neither can swallow the other.
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      out.push(<strong key={`${keyBase}-b${i}`} className="font-semibold text-ink">{m[1]}</strong>)
    } else {
      out.push(
        <code key={`${keyBase}-c${i}`} className="rounded-field bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">
          {m[2]}
        </code>,
      )
    }
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function LegalDocument({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let bullets: string[] = []
  let quote: string[] = []
  let table: string[] = []
  let k = 0

  const flushQuote = () => {
    if (!quote.length) return
    // Every document opens with one of these, and it says NOT IN FORCE.
    blocks.push(
      <div key={k++} className="mb-6 border-l-4 border-ot bg-surface-2 px-4 py-3 text-sm text-ink">
        {quote.map((q, i) => <p key={i} className="mb-2 leading-relaxed last:mb-0">{inline(q, `q${k}-${i}`)}</p>)}
      </div>,
    )
    quote = []
  }

  /** Everything except the quote — what a "> " line flushes before adding to it. */
  const flushOthers = () => {
    if (para.length) {
      blocks.push(<p key={k++} className="mb-4 leading-relaxed text-ink">{inline(para.join(' '), `p${k}`)}</p>)
      para = []
    }
    if (bullets.length) {
      blocks.push(
        <ul key={k++} className="mb-4 list-disc space-y-1.5 pl-5 text-ink">
          {bullets.map((b, i) => <li key={i} className="leading-relaxed">{inline(b, `l${k}-${i}`)}</li>)}
        </ul>,
      )
      bullets = []
    }
    if (table.length) {
      const rows = table
        // Drop the alignment row: bars, dashes, colons and spaces only.
        .filter(r => !/^[|\s:-]+$/.test(r))
        .map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
      const [head, ...body] = rows
      blocks.push(
        <div key={k++} className="mb-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>{head.map((c, i) => (
                <th key={i} className="border-b-2 border-ink px-2 py-2 text-left font-display text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {inline(c, `th${k}-${i}`)}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => (
                  <td key={ci} className="border-b border-line px-2 py-2 align-top text-ink">{inline(c, `td${k}-${ri}-${ci}`)}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      table = []
    }
  }

  const flush = () => { flushOthers(); flushQuote() }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('> ')) {
      flushOthers()
      // Continue the paragraph unless the last line was a bare ">", which is
      // how these documents separate paragraphs inside the warning.
      if (quote.length && quote[quote.length - 1] !== '') quote[quote.length - 1] += ' ' + line.slice(2)
      else if (quote.length) quote[quote.length - 1] = line.slice(2)
      else quote.push(line.slice(2))
      continue
    }
    if (line === '>') { if (quote.length) quote.push(''); continue }
    if (quote.length) flushQuote()

    // Any pipe line, not just '| ' — the |---|---| separator has no space after
    // the bar and was falling through to be printed as a paragraph.
    if (line.startsWith('|')) { table.push(line); continue }
    if (table.length && !line.startsWith('|')) flush()

    if (line.startsWith('## ')) {
      flush()
      blocks.push(
        <h2 key={k++} className="mb-3 mt-8 border-b-2 border-ink pb-1.5 font-display text-lg font-bold uppercase tracking-wide text-ink">
          {inline(line.slice(3), `h${k}`)}
        </h2>,
      )
      continue
    }
    if (line.startsWith('# ')) {
      flush()
      blocks.push(
        <h1 key={k++} className="mb-2 font-display text-3xl font-bold uppercase tracking-tight text-ink">
          {inline(line.slice(2), `h1${k}`)}
        </h1>,
      )
      continue
    }
    if (line.startsWith('- ')) { if (para.length) flush(); bullets.push(line.slice(2)); continue }
    if (bullets.length && line !== '' && !line.startsWith('- ') && !line.startsWith('  ')) flush()
    if (bullets.length && line.startsWith('  ')) { bullets[bullets.length - 1] += ' ' + line.trim(); continue }

    if (line === '---') { flush(); blocks.push(<hr key={k++} className="my-8 border-line" />); continue }
    if (line === '') { flush(); continue }
    para.push(line)
  }
  flush()

  return <div className="text-[15px]">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}
