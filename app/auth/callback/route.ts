import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { acceptInvite } from '@/lib/invite'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const inviteToken = searchParams.get('invite_token')
  const next = searchParams.get('next')

  if (code) {
    const supabase = await createClient()
    const { data } = await supabase.auth.exchangeCodeForSession(code)

    if (inviteToken && data.user) {
      const result = await acceptInvite(inviteToken, data.user.id, data.user.email)
      if (result.error) {
        return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(result.error)}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}${next || '/dashboard'}`)
}
