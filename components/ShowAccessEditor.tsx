'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Card from '@/components/ui/Card'
import Toggle from '@/components/ui/Toggle'

// Who can OPEN this show in the app.
//
// This is about `profiles` — the people with CrewTracker logins — and is a
// completely separate concept from the `crew_members` staffed into rooms on the
// tracker. Naming it "Show Access" rather than anything with "crew" in it is
// deliberate; conflating the two is the obvious way for this screen to confuse
// someone.
//
// Background: a show is visible to a user when they can see all shows, OR they
// created it, OR they have a show_assignments row. Until this editor existed
// nothing in the app ever wrote that table, so an invited PM signed in to an
// empty app with no in-product way to fix it.
//
// Writes land immediately rather than being folded into Edit Show's single Save
// button — that button already batches the show fields and the whole payroll
// ruleset, and access control is a different concern with a different blast
// radius. Same immediate-write pattern as AVRolesEditor.

export type OrgMember = {
  id: string
  full_name: string | null
  email: string | null
  base_role: string | null
  can_edit_all_shows: boolean
}

export default function ShowAccessEditor({
  showId,
  members,
  initialAssignedIds,
  createdBy,
}: {
  showId: string
  members: OrgMember[]
  initialAssignedIds: string[]
  createdBy: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [assigned, setAssigned] = useState<Set<string>>(new Set(initialAssignedIds))
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function toggle(memberId: string, next: boolean) {
    setBusyId(memberId)
    setError('')

    // Optimistic, then reconciled by router.refresh(); reverted on failure so
    // the switch can never sit in a state the database disagrees with.
    setAssigned(prev => {
      const s = new Set(prev)
      if (next) s.add(memberId); else s.delete(memberId)
      return s
    })

    const { error: e } = next
      ? await supabase.from('show_assignments').insert({ show_id: showId, profile_id: memberId })
      : await supabase.from('show_assignments').delete()
          .eq('show_id', showId).eq('profile_id', memberId)

    setBusyId(null)

    if (e) {
      setAssigned(prev => {
        const s = new Set(prev)
        if (next) s.delete(memberId); else s.add(memberId)
        return s
      })
      setError(e.message)
      return
    }
    router.refresh()
  }

  const label = (m: OrgMember) => m.full_name?.trim() || m.email || 'Unnamed member'

  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-ink">Show Access</h2>
      <p className="mt-1 text-sm text-muted">
        Who can open this show in CrewTracker. This is separate from the crew staffed
        into rooms — it controls who can sign in and see the show at all.
      </p>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-4 flex flex-col gap-2">
        {members.length === 0 && (
          <p className="text-sm text-muted">No other members in your organization yet.</p>
        )}

        {members.map(m => {
          // Two ways to already have access that an assignment can't add to and
          // removing an assignment can't take away. Showing a live switch for
          // these would imply control this screen doesn't have.
          const seesEverything = m.can_edit_all_shows
          const isCreator = m.id === createdBy
          const implicit = seesEverything || isCreator

          return (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-field bg-surface-2 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{label(m)}</p>
                <p className="truncate text-xs text-muted">
                  {m.email}
                  {m.base_role ? ` · ${m.base_role}` : ''}
                </p>
              </div>

              {implicit ? (
                <span className="flex-none text-xs text-muted">
                  {seesEverything ? 'Sees all shows' : 'Created this show'}
                </span>
              ) : (
                <Toggle
                  checked={assigned.has(m.id)}
                  disabled={busyId === m.id}
                  onChange={next => toggle(m.id, next)}
                  label={`Give ${label(m)} access to this show`}
                />
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
