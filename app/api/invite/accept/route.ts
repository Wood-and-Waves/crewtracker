import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { acceptInvite } from '@/lib/invite'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { token } = await request.json()
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const result = await acceptInvite(token, user.id, user.email)
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ success: true })
}
