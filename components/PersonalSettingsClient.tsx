'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Card from '@/components/ui/Card'
import Toggle from '@/components/ui/Toggle'
import ThemeToggle from '@/components/ui/ThemeToggle'

export default function PersonalSettingsClient({
  use24HourTime,
  shoulderSurferMode,
}: {
  use24HourTime: boolean
  shoulderSurferMode: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState<string | null>(null)

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
    </Card>
  )
}
