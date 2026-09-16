import type { Metadata } from 'next'
import LegalDocument from '@/components/LegalDocument'
import LegalShell from '@/components/LegalShell'
import { PRIVACY_MD } from '@/lib/legalDocs'

// PUBLIC, and allowlisted in proxy.ts — a crew member who got an email from us
// has no account and must still be able to read this.
export const metadata: Metadata = {
  title: 'Privacy Policy — CrewTracker',
  description: 'What CrewTracker holds about people, and why. Draft, not in force.',
  robots: { index: false, follow: false },
}

export default function PrivacyPage() {
  return (
    <LegalShell other={{ href: '/terms', label: 'Terms of Service' }}>
      <LegalDocument markdown={PRIVACY_MD} />
    </LegalShell>
  )
}
