import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import EditShowClient from '@/components/EditShowClient'

export default async function EditShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // show/ruleset/workDays are independent of each other (none depend on
  // another's result) so fetch them in one round trip instead of three.
  const [
    { data: show },
    { data: ruleset },
    { data: workDays },
  ] = await Promise.all([
    supabase.from('shows').select('*').eq('id', id).single(),
    supabase.from('payroll_rulesets').select('*').eq('show_id', id).single(),
    supabase.from('work_days').select('*').eq('show_id', id).order('day_number'),
  ])

  if (!show) notFound()

  const workDayIds = (workDays || []).map(d => d.id)

  const { data: rooms } = workDayIds.length > 0
    ? await supabase.from('rooms').select('id, name, work_day_id').in('work_day_id', workDayIds)
    : { data: [] }

  const roomIds = (rooms || []).map(r => r.id)

  const { data: timecards } = roomIds.length > 0
    ? await supabase.from('timecards').select('crew_member_id, crew_member_name, role, day_rate, room_id').in('room_id', roomIds)
    : { data: [] }

  // Dedupe to unique (crew, role) combos, matching iOS crewRateEntries logic
  const seen: Record<string, any> = {}
  for (const tc of timecards || []) {
    const key = (tc.crew_member_id || tc.crew_member_name) + '|' + tc.role
    if (!seen[key]) {
      seen[key] = { crewMemberId: tc.crew_member_id, name: tc.crew_member_name, role: tc.role, dayRate: tc.day_rate }
    }
  }
  const crewRateEntries = Object.values(seen).sort((a: any, b: any) => a.name.localeCompare(b.name))

  return (
    <EditShowClient
      show={show}
      ruleset={ruleset}
      workDays={workDays || []}
      rooms={rooms || []}
      crewRateEntries={crewRateEntries}
    />
  )
}
