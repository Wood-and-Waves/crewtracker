import type { Metadata } from 'next'
import LegalDocument from '@/components/LegalDocument'
import LegalShell from '@/components/LegalShell'
import { TERMS_MD } from '@/lib/legalDocs'

// PUBLIC, and allowlisted in proxy.ts. Somebody has to be able to read the
// terms before they have an account — that is the whole point of them.
export const metadata: Metadata = {
  title: 'Terms of Service — CrewTracker',
  description: 'The terms CrewTracker is offered under. Draft, not in force.',
  robots: { index: false, follow: false },
}

export default function TermsPage() {
  return (
    <LegalShell other={{ href: '/privacy', label: 'Privacy Policy' }}>
      <LegalDocument markdown={TERMS_MD} />
    </LegalShell>
  )
}
