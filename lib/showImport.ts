// Import a whole show from one CSV: details, days, rooms, and the crew staffed
// into them with their own travel legs (Dan, 2026-11-06: "a way to import a
// full crew and rooms and dates into a show without manually adding").
//
// This file is PURE. It turns the file's text into a plan — what the show will
// be, who is on which day in which room, what is new to the directory — and a
// list of errors and warnings, each naming the spreadsheet row it came from.
// Nothing here touches the database; ImportShowClient writes the plan through
// the caller's own session in the same order New Show and StaffRoomModal do.
//
// THE FILE, in two parts, so it is natural in Excel and survives being
// re-saved by it (dates come back as M/D/YYYY, short rows get padded commas):
//
//   Show,PwC Tax Assurance          ← Key,Value rows, any order, only Show required
//   Venue,Hilton Anatole
//   City,"Dallas, TX"
//   Timezone,Central
//
//   Name,Role,Room,Day Rate,Phone,Email,2026-11-10,2026-11-11   ← the roster header
//   Day,,,,,,Travel + Load-in,Show                              ← what the SHOW does
//   Alex Reyes,A1,Ballroom,650,,,T,W                            ← a person's own days
//
// A crew cell is the person's day: blank = not on the show that day, W =
// works, T = a travel day with no work (is_travel_day), TI = travels in and
// works (travel_in_day), TO = works and travels out (travel_out_day). Those
// three are different payroll states — see CLAUDE.md on travel — so the file
// says which rather than offering one word that would be wrong half the time.

import { parseCsv, csvLine } from '@/lib/csv'
import { normalizeActivities, dayLabel, type Activity } from '@/lib/dayActivities'
import { SHOW_TIMEZONES, DEFAULT_SHOW_TIMEZONE } from '@/lib/timezones'
import { formatPhone } from '@/lib/phone'

export type ImportContext = {
  /** The org's payroll presets, by name; the file may name one. */
  presetNames: string[]
  knownRoles: string[]
  knownCrewNames: string[]
  canManageCrew: boolean
  canEditRates: boolean
}

export type ImportIssue = { row: number | null; message: string }

export type DayKindCell = 'work' | 'travel' | 'travel_in' | 'travel_out'

export type ImportCrewRow = {
  row: number
  name: string
  role: string
  room: string
  dayRate: number
  phone: string
  email: string
  isNew: boolean
  days: { date: string; kind: DayKindCell }[]
}

export type ImportPlan = {
  show: {
    name: string
    venue: string
    cityState: string
    clientCompany: string
    jobNumber: string
    notes: string
    timezone: string
    confirmed: boolean
    financials: boolean
    contactName: string
    contactPhone: string
    /** null = the org's default preset, as New Show does. */
    presetName: string | null
  }
  days: { date: string; activities: Activity[] }[]
  /** Distinct room names in order of first appearance. */
  rooms: string[]
  crew: ImportCrewRow[]
  newRoles: string[]
  newCrew: string[]
  timecardCount: number
}

export type ImportResult = {
  plan: ImportPlan | null
  errors: ImportIssue[]
  warnings: ImportIssue[]
}

// ---- small matchers --------------------------------------------------------

/** "Job Number", "job #", "JOB_NO." all become "jobno" / "job". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

type DetailKey = 'name' | 'venue' | 'cityState' | 'clientCompany' | 'jobNumber' | 'timezone' | 'confirmed'
  | 'financials' | 'contactName' | 'contactPhone' | 'notes' | 'presetName'

const KEY_ALIASES: Record<DetailKey, string[]> = {
  name: ['show', 'showname', 'title'],
  venue: ['venue'],
  cityState: ['city', 'citystate', 'location'],
  clientCompany: ['client', 'clientcompany', 'company'],
  jobNumber: ['jobnumber', 'job', 'jobno', 'jobid'],
  timezone: ['timezone', 'tz', 'zone'],
  confirmed: ['confirmed', 'showconfirmed'],
  financials: ['financials', 'showfinancials', 'money', 'trackmoney'],
  contactName: ['contactname', 'onsitecontact', 'contact', 'onsitecontactname'],
  contactPhone: ['contactphone', 'onsitephone', 'phone', 'onsitecontactphone'],
  notes: ['notes', 'shownotes'],
  presetName: ['payrollpreset', 'preset', 'payrollrules', 'rules'],
}

function keyFor(cell: string): DetailKey | null {
  const n = norm(cell)
  for (const key of Object.keys(KEY_ALIASES) as DetailKey[]) if (KEY_ALIASES[key].includes(n)) return key
  return null
}

const TZ_ABBREV: Record<string, string> = {
  et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York', eastern: 'America/New_York',
  ct: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago', central: 'America/Chicago',
  mt: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver', mountain: 'America/Denver',
  pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pacific: 'America/Los_Angeles',
  akt: 'America/Anchorage', akst: 'America/Anchorage', akdt: 'America/Anchorage', alaska: 'America/Anchorage',
  hit: 'Pacific/Honolulu', hst: 'Pacific/Honolulu', hawaii: 'Pacific/Honolulu',
}

export function parseTimezone(cell: string): string | null {
  const t = cell.trim()
  if (!t) return DEFAULT_SHOW_TIMEZONE
  const exact = SHOW_TIMEZONES.find(z => z.value.toLowerCase() === t.toLowerCase())
  if (exact) return exact.value
  const n = norm(t.replace(/time$/i, ''))
  return TZ_ABBREV[n] ?? null
}

function parseYesNo(cell: string): boolean | null {
  const n = norm(cell)
  if (['', 'no', 'n', 'false', '0'].includes(n)) return false
  if (['yes', 'y', 'true', '1', 'x'].includes(n)) return true
  return null
}

/** YYYY-MM-DD, M/D/YYYY or M/D/YY → YYYY-MM-DD, or null. */
export function parseDateCell(cell: string): string | null {
  const t = cell.trim()
  let y: number, m: number, d: number
  let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) { y = +match[1]; m = +match[2]; d = +match[3] }
  else {
    match = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
    if (!match) return null
    m = +match[1]; d = +match[2]; y = +match[3]
    if (y < 100) y += 2000
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

function nextDate(iso: string): string {
  const dt = new Date(iso + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

const ACTIVITY_WORDS: Record<string, Activity> = {
  travel: 'travel', trav: 'travel', tr: 'travel',
  loadin: 'load_in', load: 'load_in', li: 'load_in', setup: 'load_in',
  rehearsal: 'rehearsal', rehearse: 'rehearsal', reh: 'rehearsal',
  show: 'show',
  loadout: 'load_out', strike: 'load_out', lo: 'load_out',
}

/** "Travel + Load-in" → ['travel','load_in']; an unknown word is returned. */
export function parseActivitiesCell(cell: string): { activities: Activity[]; unknown: string[] } {
  const acts: Activity[] = []
  const unknown: string[] = []
  for (const raw of cell.split(/[+/&;,·]/)) {
    const word = raw.trim()
    if (!word) continue
    const a = ACTIVITY_WORDS[norm(word)]
    if (a) acts.push(a); else unknown.push(word)
  }
  return { activities: normalizeActivities(acts), unknown }
}

const CELL_KINDS: Record<string, DayKindCell> = {
  w: 'work', x: 'work', '1': 'work', work: 'work', y: 'work', yes: 'work',
  t: 'travel', travel: 'travel',
  ti: 'travel_in', travelin: 'travel_in', in: 'travel_in',
  to: 'travel_out', travelout: 'travel_out', out: 'travel_out',
}

export function parseDayCell(cell: string): DayKindCell | null | 'bad' {
  const n = norm(cell)
  if (!n) return null
  return CELL_KINDS[n] ?? 'bad'
}

function parseRate(cell: string): number | null {
  const t = cell.replace(/[$,\s]/g, '')
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const ROSTER_COLUMNS: Record<string, string[]> = {
  name: ['name', 'crew', 'crewmember', 'person'],
  role: ['role', 'position', 'job'],
  room: ['room', 'space', 'location'],
  rate: ['dayrate', 'rate'],
  phone: ['phone', 'mobile', 'cell'],
  email: ['email', 'emailaddress'],
}

// ---- the planner -----------------------------------------------------------

export function parseShowImport(text: string, ctx: ImportContext): ImportResult {
  const errors: ImportIssue[] = []
  const warnings: ImportIssue[] = []
  // Blank rows are nothing, and a row starting with # is a note to the person
  // filling the file in — the template ends with a key written that way, so
  // the explanation lives where the typing happens rather than on a screen.
  const records = parseCsv(text)
    .filter(r => r.cells.some(c => c.trim() !== ''))
    .filter(r => !(r.cells[0] ?? '').trim().startsWith('#'))

  // The header is the first row that has a Name column AND a date: the two
  // things no detail row has. Columns may come in any order.
  const headerIdx = records.findIndex(r =>
    r.cells.some(c => ROSTER_COLUMNS.name.includes(norm(c))) && r.cells.some(c => parseDateCell(c) !== null))
  if (headerIdx === -1) {
    return { plan: null, errors: [{ row: null, message: 'No roster found. The crew table starts with a header row holding Name, Role, Room and the dates.' }], warnings }
  }

  // ---- Part 1: show details ----
  const show: ImportPlan['show'] = {
    name: '', venue: '', cityState: '', clientCompany: '', jobNumber: '', notes: '',
    timezone: DEFAULT_SHOW_TIMEZONE, confirmed: false, financials: false,
    contactName: '', contactPhone: '', presetName: null,
  }
  for (const r of records.slice(0, headerIdx)) {
    const key = keyFor(r.cells[0] ?? '')
    const value = (r.cells[1] ?? '').trim()
    if (!key) { errors.push({ row: r.line, message: `"${r.cells[0]}" is not a show detail this import knows.` }); continue }
    switch (key) {
      case 'timezone': {
        const tz = parseTimezone(value)
        if (!tz) errors.push({ row: r.line, message: `Timezone "${value}" is not one of Eastern, Central, Mountain, Pacific, Alaska or Hawaii.` })
        else show.timezone = tz
        break
      }
      case 'confirmed': case 'financials': {
        const b = parseYesNo(value)
        if (b === null) errors.push({ row: r.line, message: `${r.cells[0]} should be Yes or No, not "${value}".` })
        else show[key] = b
        break
      }
      case 'contactPhone': show.contactPhone = value ? formatPhone(value) : ''; break
      case 'presetName': {
        if (!value) break
        const found = ctx.presetNames.find(p => p.trim().toLowerCase() === value.toLowerCase())
        if (!found) errors.push({ row: r.line, message: `No payroll preset called "${value}". Leave it blank for the default.` })
        else show.presetName = found
        break
      }
      default: (show as Record<string, unknown>)[key] = value
    }
  }
  if (!show.name) errors.push({ row: null, message: 'The show needs a name: a row reading Show,<name> above the roster.' })

  // ---- Part 2: the roster header ----
  const header = records[headerIdx]
  const col: Partial<Record<keyof typeof ROSTER_COLUMNS, number>> = {}
  const dateCols: { index: number; date: string }[] = []
  header.cells.forEach((cell, index) => {
    const t = cell.trim()
    if (!t) return
    const n = norm(t)
    const fixed = (Object.keys(ROSTER_COLUMNS) as (keyof typeof ROSTER_COLUMNS)[]).find(k => ROSTER_COLUMNS[k].includes(n))
    if (fixed && col[fixed] === undefined) { col[fixed] = index; return }
    const date = parseDateCell(t)
    if (date) { dateCols.push({ index, date }); return }
    errors.push({ row: header.line, message: `Column "${t}" is not a roster column or a date.` })
  })
  for (const k of ['name', 'role', 'room'] as const) {
    if (col[k] === undefined) errors.push({ row: header.line, message: `The roster needs a ${k === 'name' ? 'Name' : k === 'role' ? 'Role' : 'Room'} column.` })
  }
  if (dateCols.length === 0) errors.push({ row: header.line, message: 'The roster needs at least one date column.' })
  for (let i = 1; i < dateCols.length; i++) {
    const prev = dateCols[i - 1].date, cur = dateCols[i].date
    if (cur <= prev) errors.push({ row: header.line, message: `Dates must run left to right: ${cur} comes after ${prev}.` })
    else if (nextDate(prev) !== cur) errors.push({ row: header.line, message: `Dates must be every day from first to last; ${nextDate(prev)} is missing between ${prev} and ${cur}.` })
  }

  // ---- The Day row, if any ----
  const activitiesByDate = new Map<string, Activity[]>()
  let bodyStart = headerIdx + 1
  const dayRow = records[bodyStart]
  if (dayRow && ['day', 'days', 'activities', 'activity', 'showday'].includes(norm(dayRow.cells[0] ?? ''))) {
    bodyStart++
    for (const { index, date } of dateCols) {
      const cell = dayRow.cells[index] ?? ''
      const { activities, unknown } = parseActivitiesCell(cell)
      if (unknown.length) errors.push({ row: dayRow.line, message: `On ${date}, "${unknown.join('", "')}" is not an activity. Use Travel, Load-in, Rehearsal, Show or Load-out.` })
      activitiesByDate.set(date, activities)
    }
  }

  // ---- Crew rows ----
  const knownCrew = new Set(ctx.knownCrewNames.map(n => n.trim().toLowerCase()))
  const knownRoles = new Set(ctx.knownRoles.map(n => n.trim().toLowerCase()))
  const crew: ImportCrewRow[] = []
  const roomNames: string[] = []
  const roomByKey = new Map<string, string>()
  const seenCell = new Map<string, number>()        // person|room|date → row
  const rateByPersonRole = new Map<string, { rate: number; row: number }>()
  const newRoles: string[] = []
  const newCrew: string[] = []

  const roomFor = (raw: string) => {
    const name = raw.trim() || 'Main Stage'
    const key = name.toLowerCase()
    const existing = roomByKey.get(key)
    if (existing) return existing
    roomByKey.set(key, name)
    roomNames.push(name)
    return name
  }

  for (const r of records.slice(bodyStart)) {
    const cellAt = (i: number | undefined) => (i === undefined ? '' : (r.cells[i] ?? '')).trim()
    const name = cellAt(col.name)
    if (!name) { errors.push({ row: r.line, message: 'A crew row has no name.' }); continue }
    const role = cellAt(col.role)
    if (!role) { errors.push({ row: r.line, message: `${name} has no role.` }); continue }
    const dayRate = parseRate(cellAt(col.rate))
    if (dayRate === null) { errors.push({ row: r.line, message: `${name}'s day rate "${cellAt(col.rate)}" is not a number.` }); continue }
    const room = roomFor(cellAt(col.room))

    const days: ImportCrewRow['days'] = []
    let bad = false
    for (const { index, date } of dateCols) {
      const raw = r.cells[index] ?? ''
      const kind = parseDayCell(raw)
      if (kind === 'bad') { errors.push({ row: r.line, message: `"${raw.trim()}" under ${date} for ${name} is not W, T, TI or TO.` }); bad = true; continue }
      if (!kind) continue
      const cellKey = `${name.toLowerCase()}|${room.toLowerCase()}|${date}`
      const dup = seenCell.get(cellKey)
      if (dup !== undefined) { errors.push({ row: r.line, message: `${name} is already in ${room} on ${date} (row ${dup}). One person is in a room once a day.` }); bad = true; continue }
      seenCell.set(cellKey, r.line)
      days.push({ date, kind })
    }
    if (bad) continue
    if (days.length === 0) { warnings.push({ row: r.line, message: `${name} has no day marked, so they are not put on the show.` }); continue }

    const prk = `${name.toLowerCase()}|${role.toLowerCase()}`
    const prior = rateByPersonRole.get(prk)
    if (prior && prior.rate !== dayRate) {
      warnings.push({ row: r.line, message: `${name} as ${role} is $${dayRate} here and $${prior.rate} on row ${prior.row}. A rate is show-wide, so $${prior.rate} is used on every day.` })
    } else if (!prior) rateByPersonRole.set(prk, { rate: dayRate, row: r.line })

    const isNew = !knownCrew.has(name.toLowerCase())
    if (isNew && !newCrew.some(n => n.toLowerCase() === name.toLowerCase())) newCrew.push(name)
    if (!knownRoles.has(role.toLowerCase()) && !newRoles.some(n => n.toLowerCase() === role.toLowerCase())) newRoles.push(role)

    crew.push({
      row: r.line, name, role, room, dayRate,
      phone: cellAt(col.phone) ? formatPhone(cellAt(col.phone)) : '',
      email: cellAt(col.email),
      isNew, days,
    })
  }

  if (crew.length === 0 && errors.length === 0) errors.push({ row: null, message: 'No crew rows under the roster header.' })
  if (newCrew.length > 0 && !ctx.canManageCrew) {
    errors.push({ row: null, message: `${newCrew.join(', ')} ${newCrew.length === 1 ? 'is' : 'are'} not in the directory, and your account cannot add people to it.` })
  }
  if (!ctx.canEditRates && crew.some(c => c.dayRate > 0)) {
    warnings.push({ row: null, message: 'Your account cannot set pay rates, so every day rate in the file lands as 0.' })
  }

  if (errors.length > 0) return { plan: null, errors, warnings }

  const days = dateCols.map(({ date }) => ({ date, activities: activitiesByDate.get(date) ?? [] }))
  return {
    plan: {
      show, days, rooms: roomNames, crew, newRoles, newCrew,
      timecardCount: crew.reduce((n, c) => n + c.days.length, 0),
    },
    errors,
    warnings,
  }
}

// ---- the template ----------------------------------------------------------

/** The example file, dated from `start` (YYYY-MM-DD) so it is never in the past. */
export function buildTemplateCsv(start: string): string {
  const d0 = start, d1 = nextDate(d0), d2 = nextDate(d1), d3 = nextDate(d2)
  return [
    csvLine(['Show', 'Example Sales Kickoff']),
    csvLine(['Venue', 'Hilton Anatole']),
    csvLine(['City', 'Dallas, TX']),
    csvLine(['Client', 'Example Client']),
    csvLine(['Job Number', '2611-04']),
    csvLine(['Timezone', 'Central']),
    csvLine(['Confirmed', 'Yes']),
    csvLine(['Financials', 'Yes']),
    csvLine(['Contact Name', 'Ray Delgado']),
    csvLine(['Contact Phone', '(214) 555-0148']),
    csvLine(['Notes', 'Dock B for load-in']),
    '',
    csvLine(['Name', 'Role', 'Room', 'Day Rate', 'Phone', 'Email', d0, d1, d2, d3]),
    csvLine(['Day', '', '', '', '', '', 'Travel + Load-in', 'Rehearsal', 'Show', 'Show + Load-out + Travel']),
    csvLine(['Alex Reyes', 'A1', 'Ballroom', 650, '(214) 555-0101', 'alex@example.com', 'T', 'W', 'W', 'TO']),
    csvLine(['Nina Brennan', 'Stagehand', 'Ballroom', 350, '', '', '', 'W', 'W', 'W']),
    csvLine(['Theo Lindqvist', 'Camera Operator', 'Breakout A', 500, '', '', 'TI', 'W', 'W', '']),
    '',
    csvLine(['# Rows starting with # are ignored. Delete these once you know the codes.']),
    csvLine(['# Day row: what the SHOW does that day. Travel, Load-in, Rehearsal, Show, Load-out, joined with +']),
    csvLine(['# Crew cells: W works · T travel day, no work · TI travels in and works · TO works and travels out · blank = not on that day']),
    csvLine(['# Dates can be 2026-11-10 or 11/10/2026 and must run every day from first to last. Timezone: Eastern, Central, Mountain, Pacific, Alaska or Hawaii.']),
  ].join('\n') + '\n'
}

/** "Travel · Load-in" for the preview, or "—". */
export function describeImportDay(activities: Activity[]): string {
  return dayLabel(activities) ?? '—'
}
