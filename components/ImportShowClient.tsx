'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { pickRulesetValues, type RulesetValues } from '@/lib/ruleset'
import { parseShowImport, buildTemplateCsv, type ImportPlan, type ImportResult } from '@/lib/showImport'
import { dayLabel, dayActivitiesBgClass } from '@/lib/dayActivities'
import { localDateStr } from '@/lib/datetime'
import { logStaffingEvent } from '@/lib/staffingEvents'
import { compressDays } from '@/lib/readyEmail'
import { SHOW_TIMEZONES } from '@/lib/timezones'
import Button from '@/components/ui/Button'
import NumberedHead from '@/components/ui/NumberedHead'
import { BAND } from '@/lib/panel'
import { cn } from '@/lib/cn'

// Import a show from one CSV: details, days, rooms, crew with their own travel
// legs. The file is read and judged in the browser (lib/showImport.ts, pure),
// the preview says exactly what will be created, and Create writes it through
// the caller's own session in the order New Show and StaffRoomModal already
// use — shows, ruleset, work days, rooms, crew and rate cards, timecards. RLS
// is the boundary; nothing here needs the service role.
//
// NOT A TRANSACTION, like New Show. The created show id is kept so a failure
// part-way offers the show rather than stranding it, and pressing the button
// again RESUMES: every step reads what already landed before writing.

type Preset = { id: string; name: string; is_default: boolean } & RulesetValues

const CELL_WORD: Record<string, string> = { work: 'W', travel: 'T', travel_in: 'TI', travel_out: 'TO' }

function nextMonday(): string {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  return localDateStr(d)
}

export default function ImportShowClient({
  organizationId, userId, roles, presets, crewNames, canManageCrew, canEditRates,
}: {
  organizationId: string
  userId: string
  roles: string[]
  presets: Preset[]
  crewNames: string[]
  canManageCrew: boolean
  canEditRates: boolean
}) {
  const router = useRouter()
  const supabase = createClient()

  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [createdShowId, setCreatedShowId] = useState<string | null>(null)

  const ctx = useMemo(() => ({
    presetNames: presets.map(p => p.name), knownRoles: roles, knownCrewNames: crewNames, canManageCrew, canEditRates,
  }), [presets, roles, crewNames, canManageCrew, canEditRates])

  async function chooseFile(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setError('')
    setCreatedShowId(null)
    setResult(parseShowImport(await file.text(), ctx))
  }

  function downloadTemplate() {
    const blob = new Blob([buildTemplateCsv(nextMonday())], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'crewtracker-show-import.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function createShow(plan: ImportPlan) {
    setError('')
    setLoading(true)
    const fail = (msg: string) => { setError(msg); setLoading(false) }

    // 1. The show.
    let showId: string
    if (createdShowId) {
      showId = createdShowId
    } else {
      const { data, error: showError } = await supabase
        .from('shows')
        .insert({
          organization_id: organizationId,
          name: plan.show.name,
          venue: plan.show.venue || null,
          city_state: plan.show.cityState || null,
          client_company: plan.show.clientCompany || null,
          job_number: plan.show.jobNumber || null,
          show_notes: plan.show.notes || null,
          show_financials: plan.show.financials,
          onsite_contact_name: plan.show.contactName || null,
          onsite_contact_phone: plan.show.contactPhone || null,
          start_date: plan.days[0].date,
          end_date: plan.days[plan.days.length - 1].date,
          timezone_identifier: plan.show.timezone,
          confirmed_at: plan.show.confirmed ? new Date().toISOString() : null,
          // Stamped as already told: the sheet is a roster of people who are
          // booked and know it, so a "Tell the crew" button would only invite
          // an email nobody needs (Dan, 2026-11-12). See migration 0043.
          confirmed_notice_sent_at: plan.show.confirmed ? new Date().toISOString() : null,
          created_by: userId,
        })
        .select('id')
        .single()
      if (showError || !data) return fail(showError?.message || 'The show could not be created.')
      showId = data.id
      setCreatedShowId(data.id)
    }
    const resuming = !!createdShowId

    // 2. Payroll rules, COPIED from the preset (the file's, or the default).
    const preset = plan.show.presetName
      ? presets.find(p => p.name === plan.show.presetName)
      : presets.find(p => p.is_default)
    const prior = resuming
      ? await supabase.from('payroll_rulesets').select('id').eq('show_id', showId).maybeSingle()
      : null
    if (!prior?.data) {
      const { error: e } = await supabase
        .from('payroll_rulesets')
        .insert(preset ? { show_id: showId, ...pickRulesetValues(preset) } : { show_id: showId })
      if (e) return fail(`Created the show, but the payroll rules did not land: ${e.message}`)
    }

    // 3. Work days.
    let days = resuming
      ? (await supabase.from('work_days').select('id, date').eq('show_id', showId)).data ?? []
      : []
    if (days.length === 0) {
      const { data, error: e } = await supabase
        .from('work_days')
        .insert(plan.days.map((d, i) => ({ show_id: showId, date: d.date, day_number: i + 1, activities: d.activities })))
        .select('id, date')
      if (e || !data) return fail(`Created the show, but the days did not land: ${e?.message}`)
      days = data
    }
    const dayIdByDate = new Map(days.map(d => [d.date, d.id]))

    // 4. Every room on every day; created_at ordered as in the file so the
    //    tracker lists them the same way on every day (NewShowClient).
    const dayIds = days.map(d => d.id)
    let rooms = resuming
      ? (await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', dayIds)).data ?? []
      : []
    if (rooms.length === 0) {
      const base = Date.now()
      const rows = plan.rooms.flatMap((name, i) =>
        days.map(d => ({ work_day_id: d.id, name, created_at: new Date(base + i).toISOString() })))
      const { data, error: e } = await supabase.from('rooms').insert(rows).select('id, name, work_day_id')
      if (e || !data) return fail(`Created the show, but the rooms did not land: ${e?.message}`)
      rooms = data
    }
    const roomId = (name: string, date: string) =>
      rooms.find(r => r.name.toLowerCase() === name.toLowerCase() && r.work_day_id === dayIdByDate.get(date))?.id

    // 5. Crew: match by name in the directory, add the rest, fill a blank
    //    phone or email, add unknown roles to AV Roles, rate cards for pairs
    //    they lack. A plain insert after a read, never the upsert.
    const { data: dir, error: dirError } = await supabase
      .from('crew_members').select('id, full_name, phone, email').eq('organization_id', organizationId)
    if (dirError) return fail(`Created the show, but the directory could not be read: ${dirError.message}`)
    const byName = new Map((dir ?? []).map(c => [c.full_name.trim().toLowerCase(), c]))

    const toAdd = plan.crew.filter(c => !byName.has(c.name.toLowerCase()))
      .filter((c, i, arr) => arr.findIndex(o => o.name.toLowerCase() === c.name.toLowerCase()) === i)
    if (toAdd.length > 0) {
      const { data, error: e } = await supabase
        .from('crew_members')
        .insert(toAdd.map(c => ({ organization_id: organizationId, full_name: c.name, phone: c.phone || null, email: c.email || null })))
        .select('id, full_name, phone, email')
      if (e || !data) return fail(`Created the show, but ${toAdd.map(c => c.name).join(', ')} could not be added to the directory: ${e?.message}`)
      for (const c of data) byName.set(c.full_name.trim().toLowerCase(), c)
    }
    for (const c of plan.crew) {
      const m = byName.get(c.name.toLowerCase())
      if (!m) continue
      const patch: Record<string, string> = {}
      if (!m.phone && c.phone) patch.phone = c.phone
      if (!m.email && c.email) patch.email = c.email
      if (Object.keys(patch).length) {
        await supabase.from('crew_members').update(patch).eq('id', m.id)
        Object.assign(m, patch)
      }
    }

    if (plan.newRoles.length > 0) {
      const { data: existing } = await supabase.from('av_roles').select('name, sort_order').eq('organization_id', organizationId)
      const have = new Set((existing ?? []).map(r => r.name.toLowerCase()))
      const next = Math.max(0, ...(existing ?? []).map(r => r.sort_order ?? 0)) + 1
      const rows = plan.newRoles.filter(r => !have.has(r.toLowerCase()))
        .map((name, i) => ({ organization_id: organizationId, name, sort_order: next + i }))
      if (rows.length) {
        const { error: e } = await supabase.from('av_roles').insert(rows)
        if (e) console.error('import: av_roles insert failed', e)
      }
    }

    const crewIds = [...new Set(plan.crew.map(c => byName.get(c.name.toLowerCase())?.id).filter(Boolean))] as string[]
    const { data: cards } = await supabase.from('rate_cards').select('crew_member_id, role').in('crew_member_id', crewIds)
    const haveCard = new Set((cards ?? []).map(r => `${r.crew_member_id}|${r.role.toLowerCase()}`))
    const cardRows: { crew_member_id: string; role: string; day_rate: number }[] = []
    for (const c of plan.crew) {
      const id = byName.get(c.name.toLowerCase())?.id
      if (!id) continue
      const k = `${id}|${c.role.toLowerCase()}`
      if (haveCard.has(k)) continue
      haveCard.add(k)
      cardRows.push({ crew_member_id: id, role: c.role, day_rate: c.dayRate })
    }
    if (cardRows.length) {
      const { error: e } = await supabase.from('rate_cards').insert(cardRows)
      if (e) console.error('import: rate_cards insert failed', e)
    }

    // 6. Timecards. On a resume the ones already there are skipped: the
    //    unique (room, person) index would refuse them anyway.
    const taken = new Set<string>()
    if (resuming) {
      const { data } = await supabase.from('timecards').select('room_id, crew_member_id').eq('show_id', showId)
      for (const t of data ?? []) taken.add(`${t.room_id}|${t.crew_member_id}`)
    }
    const tcRows: Record<string, unknown>[] = []
    const datesByPerson = new Map<string, { id: string; name: string; role: string; dates: string[] }>()
    for (const c of plan.crew) {
      const m = byName.get(c.name.toLowerCase())
      if (!m) return fail(`Created the show, but ${c.name} is not in the directory.`)
      for (const d of c.days) {
        const rid = roomId(c.room, d.date)
        if (!rid) return fail(`Created the show, but there is no ${c.room} on ${d.date}.`)
        if (taken.has(`${rid}|${m.id}`)) continue
        taken.add(`${rid}|${m.id}`)
        tcRows.push({
          room_id: rid,
          crew_member_id: m.id,
          crew_member_name: m.full_name,
          role: c.role,
          day_rate: c.dayRate,
          // The sheet is the roster of people already booked — see the plan.
          booking_status: 'confirmed',
          booking_responded_at: new Date().toISOString(),
          is_travel_day: d.kind === 'travel',
          travel_in_day: d.kind === 'travel_in',
          travel_out_day: d.kind === 'travel_out',
        })
        const p = datesByPerson.get(m.id) ?? { id: m.id, name: m.full_name, role: c.role, dates: [] as string[] }
        p.dates.push(d.date)
        datesByPerson.set(m.id, p)
      }
    }
    if (tcRows.length > 0) {
      const { error: e } = await supabase.from('timecards').insert(tcRows)
      if (e) return fail(`Created the show, but the crew did not land: ${e.message}`)
      for (const p of datesByPerson.values()) {
        await logStaffingEvent(supabase, {
          showId, kind: 'booked', crewMemberId: p.id, crewMemberName: p.name, role: p.role, days: compressDays(p.dates),
        })
      }
    }

    router.push(`/dashboard/shows/${showId}`)
  }

  const plan = result?.plan ?? null
  const tzLabel = plan ? SHOW_TIMEZONES.find(z => z.value === plan.show.timezone)?.label ?? plan.show.timezone : ''
  const crewOn = (date: string) => plan ? plan.crew.filter(c => c.days.some(d => d.date === date)).length : 0

  return (
    <div className="p-6 pb-32 md:p-10">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Back to Shows</Link>

      <div className={cn(BAND, '-mx-6 md:-mx-10 mb-8 mt-3 px-6 py-5 md:px-10')}>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Import Show</h1>
      </div>

      {error && (
        <div className="mb-4 rounded-field border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <p>{error}</p>
          {createdShowId && (
            <Link href={`/dashboard/shows/${createdShowId}`} className="mt-1 inline-block font-semibold underline">
              Open the show anyway
            </Link>
          )}
        </div>
      )}

      <section className="mb-9">
        <NumberedHead n="1" title="The File" className="mb-4" />
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer">
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={e => chooseFile(e.target.files?.[0])} />
            <span className="inline-flex items-center rounded-field bg-accent px-4 py-2.5 text-[13px] font-bold uppercase tracking-[0.07em] text-accent-ink hover:opacity-90">
              Choose CSV
            </span>
          </label>
          <Button variant="ghost" onClick={downloadTemplate}>Download template</Button>
          {fileName && <span className="text-sm text-muted">{fileName}</span>}
        </div>
      </section>

      {result && result.errors.length > 0 && (
        <section className="mb-9">
          <NumberedHead n="2" title="Fix These First" className="mb-4" />
          <ul className="divide-y divide-line border-b-[3px] border-ink">
            {result.errors.map((e, i) => (
              <li key={i} className="flex gap-4 py-2 text-sm text-danger">
                <span className="w-16 shrink-0 font-mono text-muted">{e.row ? `Row ${e.row}` : ''}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && result.warnings.length > 0 && (
        <section className="mb-9">
          <NumberedHead n={plan ? '2' : '3'} title="Worth Knowing" className="mb-4" />
          <ul className="divide-y divide-line border-b-[3px] border-ink">
            {result.warnings.map((w, i) => (
              <li key={i} className="flex gap-4 py-2 text-sm text-ot">
                <span className="w-16 shrink-0 font-mono text-muted">{w.row ? `Row ${w.row}` : ''}</span>
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan && (
        <>
          <section className="mb-9">
            <NumberedHead n={result?.warnings.length ? '3' : '2'} title="Show Details" className="mb-4" />
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              {([
                ['Show', plan.show.name],
                ['Venue', plan.show.venue],
                ['City', plan.show.cityState],
                ['Client', plan.show.clientCompany],
                ['Job number', plan.show.jobNumber],
                ['Timezone', tzLabel],
                ['Confirmed', plan.show.confirmed ? 'Yes' : 'No'],
                ['Financials', plan.show.financials ? 'Yes' : 'No'],
                ['On-site contact', [plan.show.contactName, plan.show.contactPhone].filter(Boolean).join(' · ')],
                ['Payroll rules', plan.show.presetName ?? (presets.find(p => p.is_default)?.name ? `${presets.find(p => p.is_default)!.name} (default)` : 'Database defaults')],
                ['Notes', plan.show.notes],
              ] as [string, string][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mb-9">
            <NumberedHead n={result?.warnings.length ? '4' : '3'} title={`${plan.days.length} Days`} className="mb-4" />
            <div className="border-b-[3px] border-ink">
              {plan.days.map((d, i) => (
                <div key={d.date} className="flex items-center gap-4 border-b border-line py-2 text-sm">
                  <span className="w-8 font-display font-semibold text-muted">{i + 1}</span>
                  <span className={cn('h-3 w-3 shrink-0', dayActivitiesBgClass(d.activities) ?? 'bg-surface-2 border border-line')} />
                  <span className="w-28 font-mono text-ink">{d.date}</span>
                  <span className="flex-1 text-ink">{dayLabel(d.activities) ?? <span className="text-muted">—</span>}</span>
                  <span className="text-muted">{crewOn(d.date)} crew</span>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-9">
            <NumberedHead
              n={result?.warnings.length ? '5' : '4'}
              title={`${plan.crew.length} Crew in ${plan.rooms.length} ${plan.rooms.length === 1 ? 'Room' : 'Rooms'}`}
              className="mb-4"
            />
            {(plan.newCrew.length > 0 || plan.newRoles.length > 0) && (
              <p className="mb-3 text-sm text-muted">
                {plan.newCrew.length > 0 && <>New to the directory: <span className="text-ink">{plan.newCrew.join(', ')}</span>. </>}
                {plan.newRoles.length > 0 && <>New roles: <span className="text-ink">{plan.newRoles.join(', ')}</span>.</>}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 border-b-2 border-ink text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Role</th>
                    <th className="px-2 py-2">Room</th>
                    {canEditRates && <th className="px-2 py-2 text-right">Rate</th>}
                    {plan.days.map(d => <th key={d.date} className="px-2 py-2 text-center font-mono">{d.date.slice(5)}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {plan.crew.map(c => (
                    <tr key={c.row}>
                      <td className="px-2 py-2 text-ink">{c.name}{c.isNew && <span className="ml-2 text-xs uppercase tracking-wide text-accent">new</span>}</td>
                      <td className="px-2 py-2 text-ink">{c.role}</td>
                      <td className="px-2 py-2 text-ink">{c.room}</td>
                      {canEditRates && <td className="px-2 py-2 text-right font-mono text-ink">{c.dayRate ? `$${c.dayRate}` : ''}</td>}
                      {plan.days.map(d => {
                        const k = c.days.find(x => x.date === d.date)?.kind
                        return (
                          <td key={d.date} className={cn('px-2 py-2 text-center font-mono', k && k !== 'work' ? 'text-day-travel font-semibold' : 'text-ink')}>
                            {k ? CELL_WORD[k] : ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-b-[3px] border-ink" />
          </section>

          <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center border-t border-line bg-bg px-4 py-3 lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-auto lg:-translate-x-1/2 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
            <Button onClick={() => createShow(plan)} disabled={loading} className="w-full lg:w-auto">
              {loading ? 'Creating…' : createdShowId ? 'Try again' : `Create show with ${plan.timecardCount} crew days`}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
