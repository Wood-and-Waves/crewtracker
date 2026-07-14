'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
    <div className="rounded-2xl bg-zinc-900 p-5 mb-6">
      <h2 className="text-lg font-bold text-white mb-4">Personal Preferences</h2>

      <div className="flex items-center justify-between py-3 border-b border-zinc-800">
        <div>
          <p className="text-sm text-white">24-hour time</p>
          <p className="text-xs text-zinc-500">Show punch times as 14:30 instead of 2:30 PM.</p>
        </div>
        <button
          onClick={() => toggle('use_24_hour_time', !use24HourTime)}
          disabled={saving === 'use_24_hour_time'}
          className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${use24HourTime ? 'bg-blue-600' : 'bg-zinc-700'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${use24HourTime ? 'left-5' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="flex items-center justify-between py-3">
        <div>
          <p className="text-sm text-white">Shoulder Surfer Mode</p>
          <p className="text-xs text-zinc-500">Hide dollar amounts on screen behind *** — useful on a shared device.</p>
        </div>
        <button
          onClick={() => toggle('shoulder_surfer_mode', !shoulderSurferMode)}
          disabled={saving === 'shoulder_surfer_mode'}
          className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${shoulderSurferMode ? 'bg-blue-600' : 'bg-zinc-700'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${shoulderSurferMode ? 'left-5' : 'left-0.5'}`} />
        </button>
      </div>
    </div>
  )
}
