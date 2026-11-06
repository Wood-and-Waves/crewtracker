// A real CSV reader (RFC 4180): quoted fields, "" inside quotes, commas and
// line breaks inside quotes, CRLF line endings, a leading byte-order mark.
//
// Written for the show import (2026-11-06) because the Directory's importer
// splits each line on ',' — fine for the five columns it was built for, wrong
// the moment a cell is "Dallas, TX", which Excel quotes without asking.
//
// Each record remembers the LINE it started on, so an error can say "row 14"
// and mean the row the person sees in their spreadsheet. A record that spans
// lines (a quoted line break) counts from its first line.
//
// Plain module, no 'use client': the planner and its test import it.

export type CsvRecord = { cells: string[]; line: number }

export function parseCsv(text: string): CsvRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1
  let i = 0

  const endCell = () => { cells.push(cell); cell = '' }
  const endRecord = () => {
    endCell()
    records.push({ cells, line: recordLine })
    cells = []
    recordLine = line
  }

  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      if (ch === '\n') line++
      cell += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { endCell(); i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { line++; endRecord(); i++; continue }
    cell += ch; i++
  }
  // The last record has no trailing newline in most files. A file that ends
  // with one leaves an empty cell pending, which is not a record.
  if (cell !== '' || cells.length > 0) endRecord()
  return records
}

/** One cell, quoted the way lib/reportCsv.ts quotes: always, with "" escapes. */
export function csvCell(v: string | number | null | undefined): string {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"'
}

export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}
