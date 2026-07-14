'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ArchiveShowButton({
  showId,
  archived,
}: {
  showId: string
  archived: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)
    const { error } = await supabase.from('shows').update({ archived: !archived }).eq('id', showId)
    setLoading(false)
    if (!error) router.refresh()
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className="absolute top-4 right-4 rounded-pill bg-surface-2 border border-line px-3 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {loading ? '...' : archived ? 'Unarchive' : 'Archive'}
    </button>
  )
}
