'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Card from '@/components/ui/Card'
import Toggle from '@/components/ui/Toggle'
import ThemeToggle from '@/components/ui/ThemeToggle'
import Button from '@/components/ui/Button'

export default function PersonalSettingsClient({
  use24HourTime,
  shoulderSurferMode,
  fullName = '',
}: {
  use24HourTime: boolean
  shoulderSurferMode: boolean
  /** profiles.full_name. Empty for anyone who signed up with email and password:
   *  the invite flow never captured a name, and only Google SSO supplied one, so
   *  those members showed as "—" everywhere. */
  fullName?: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [name, setName] = useState(fullName)
  const [nameSaved, setNameSaved] = useState(false)

  async function saveName() {
    const trimmed = name.trim()
    if (trimmed === (fullName || '').trim()) return
    setSaving('full_name')
    setNameSaved(false)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({ full_name: trimmed || null }).eq('id', user.id)
    }
    setSaving(null)
    setNameSaved(true)
    router.refresh()
  }

  async function logOut() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function toggle(field: 'use_24_hour_time' | 'shoulder_surfer_mode', value: boolean) {
    setSaving(field)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({ [field]: value }).eq('id', user.id)
    }
    setSaving(null)
    router.refresh()
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-ink mb-4">Personal Preferences</h2>

      <div className="py-3 border-b border-line">
        <label htmlFor="full-name" className="block text-sm text-ink">Your name</label>
        <p className="text-xs text-muted mb-2">
          Shown to your team and on the shows you&rsquo;re assigned to.
        </p>
        <div className="flex items-center gap-2">
          <input
            id="full-name"
            value={name}
            onChange={e => { setName(e.target.value); setNameSaved(false) }}
            onBlur={saveName}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="e.g. Dan Smith"
            className="flex-1 rounded-field bg-surface-2 border border-line px-3 py-2 text-sm text-ink placeholder:text-muted outline-none focus:border-accent"
          />
          {saving === 'full_name' && <span className="text-xs text-muted">Saving…</span>}
          {nameSaved && saving !== 'full_name' && <span className="text-xs text-good">Saved</span>}
        </div>
      </div>

      <div className="flex items-center justify-between py-3 border-b border-line">
        <div>
          <p className="text-sm text-ink">Appearance</p>
          <p className="text-xs text-muted">Switch between light and dark on this device.</p>
        </div>
        <ThemeToggle />
      </div>

      <div className="flex items-center justify-between py-3 border-b border-line">
        <div>
          <p className="text-sm text-ink">24-hour time</p>
          <p className="text-xs text-muted">Show punch times as 14:30 instead of 2:30 PM.</p>
        </div>
        <Toggle
          checked={use24HourTime}
          onChange={v => toggle('use_24_hour_time', v)}
          disabled={saving === 'use_24_hour_time'}
          label="24-hour time"
        />
      </div>

      <div className="flex items-center justify-between py-3">
        <div>
          <p className="text-sm text-ink">Shoulder Surfer Mode</p>
          <p className="text-xs text-muted">Hide dollar amounts on screen behind ••• — useful on a shared device.</p>
        </div>
        <Toggle
          checked={shoulderSurferMode}
          onChange={v => toggle('shoulder_surfer_mode', v)}
          disabled={saving === 'shoulder_surfer_mode'}
          label="Shoulder Surfer Mode"
        />
      </div>

      <div className="flex items-center justify-between pt-4 mt-3 border-t border-line">
        <div>
          <p className="text-sm text-ink">Account</p>
          <p className="text-xs text-muted">Sign out of CrewTracker on this device.</p>
        </div>
        <Button variant="danger" size="sm" onClick={logOut} disabled={loggingOut}>
          {loggingOut ? 'Logging out…' : 'Log out'}
        </Button>
      </div>
    </Card>
  )
}
