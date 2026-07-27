import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy — CrewTracker',
  description: 'How CrewTracker handles personal information for account holders and for crew.',
}

// Written against what the app actually does as of 2026-07-27, not from a
// template. Every claim below is checkable in this repo:
//   * no analytics/tracking — package.json has 7 runtime dependencies, none of
//     them an analytics SDK, and nothing in app/ or components/ loads one
//   * subprocessors are exactly Supabase, Vercel and Resend (+ Google, only if
//     the user chooses Google sign-in)
//   * pay-rate restriction is real and enforced in Postgres, not just hidden in
//     the UI — see scripts/sql/applied/lock-down-day-rate.sql
// If any of those stop being true, this page has to change with them. A privacy
// policy that quietly drifts from the software is worse than not having one.

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="27 July 2026">
      <p>
        CrewTracker is a tool that production companies use to track crew hours and calculate
        payroll for live events. This page explains what personal information passes through it,
        why, and who can see it.
      </p>

      <h2>Two different groups of people</h2>
      <p>
        Almost every privacy question about CrewTracker depends on which of these you are, so it
        is worth separating them up front.
      </p>
      <ul>
        <li>
          <strong>Account holders</strong> — people who sign in: production managers, admins and
          office staff at a company that uses CrewTracker. They chose to create an account.
        </li>
        <li>
          <strong>Crew</strong> — the technicians whose hours are being tracked. Today, crew do
          not have logins. Their details are entered by the production company that hires them,
          and that company decides what to record and how long to keep it.
        </li>
      </ul>
      <p>
        For crew information, <strong>the production company is responsible for the data and we
        act on their instructions.</strong> We do not decide what crew details get collected, we
        do not contact crew, and we do not use their information for anything other than running
        the service for that company. If you are a crew member and want to know what a company
        holds about you, ask that company first — they control it. We will help them respond.
      </p>

      <h2>What we collect</h2>
      <h3>If you have an account</h3>
      <ul>
        <li>Your email address and name.</li>
        <li>
          A password, stored only as a secure one-way hash by our authentication provider — we
          never see or store the password itself. If you sign in with Google instead, we receive
          your email address and name from Google and no password exists.
        </li>
        <li>
          Your preferences: light or dark theme, 12- or 24-hour time, and whether to hide dollar
          amounts on screen.
        </li>
        <li>Which organisation you belong to and what you are permitted to do within it.</li>
      </ul>

      <h3>If you are crew</h3>
      <ul>
        <li>Your name, and optionally your email address, phone number and free-text notes.</li>
        <li>Your role on a show and your agreed day rate.</li>
        <li>
          The times you started, broke for meals and wrapped, along with travel and half-day
          flags — the information needed to work out what you are owed.
        </li>
      </ul>

      <h3>Show information</h3>
      <p>
        Show names, venues, dates, and optionally a client company name and job number. This is
        business information rather than personal information, but it sits alongside the above.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>
          <strong>No advertising, no tracking, no analytics.</strong> CrewTracker loads no
          analytics scripts, no advertising pixels and no third-party trackers of any kind.
        </li>
        <li>
          <strong>No selling or sharing.</strong> We do not sell personal information, and we do
          not share it with anyone except the service providers listed below, who process it
          only to run CrewTracker.
        </li>
        <li>
          <strong>No cross-company visibility.</strong> One production company cannot see
          another&rsquo;s shows, crew or rates.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        We use cookies only to keep you signed in. There are no advertising or analytics cookies,
        which is why you are not asked to accept any. Your theme choice is stored in your
        browser&rsquo;s local storage on your own device and is never sent to us.
      </p>

      <h2>Who else processes your information</h2>
      <p>
        We use a small number of service providers, each handling data only to operate
        CrewTracker on our behalf. Information is stored and processed in the United States.
      </p>
      <ul>
        <li><strong>Supabase</strong> — the database and sign-in system where all information is stored.</li>
        <li><strong>Vercel</strong> — hosting, which serves the application and keeps operational logs.</li>
        <li><strong>Resend</strong> — sending email, used for end-of-show payroll reports and account email.</li>
        <li><strong>Google</strong> — only if you choose to sign in with a Google account.</li>
      </ul>

      <h2>How information is protected</h2>
      <p>
        Access rules are enforced by the database itself, not merely hidden in the interface.
        Every request is checked against the organisation you belong to, so data belonging to
        another company is not returned even to a direct query.
      </p>
      <p>
        <strong>Pay rates are restricted further.</strong> Someone without permission to view pay
        rates cannot read them at all — the restriction is applied at the database level, so it
        holds regardless of how the request is made. This is what lets a production manager run a
        show, submit the final payroll report and never see anyone&rsquo;s rate.
      </p>
      <p>
        Within a company, an administrator controls what each person can do through individual
        permissions covering crew details, pay rates, reports and user management.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Records are kept for as long as the production company keeps them — payroll records are
        typically retained for several years to satisfy tax and employment requirements, and that
        judgement belongs to the company, not to us. When an account or organisation is closed,
        we delete the associated data within 90 days except where we are required to keep it
        longer.
      </p>
      <p>
        We keep routine backups so data can be restored after a failure. Deleted information may
        persist in backups for a short period before being overwritten.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, export or delete
        personal information about you, and to object to certain processing.
      </p>
      <ul>
        <li>
          <strong>Account holders</strong> — email us and we will action your request.
        </li>
        <li>
          <strong>Crew</strong> — contact the production company that engaged you, since they
          control your record. If you cannot reach them, contact us and we will help identify
          who holds your information.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        CrewTracker is a workplace tool and is not intended for anyone under 16. We do not
        knowingly collect information about children.
      </p>

      <h2>Changes</h2>
      <p>
        If we change how information is handled we will update this page and change the date at
        the top. Significant changes will be notified to account holders by email.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy, or a request about your information:{' '}
        <a href="mailto:hello@contact.crewtracker.app">hello@contact.crewtracker.app</a>.
      </p>
      <p className="text-xs">
        [To confirm before publishing: the legal entity name and postal address of the business
        operating CrewTracker, and whether UK GDPR, EU GDPR or US state privacy laws apply to
        your customers — that determines whether this page needs a named representative, a lawful
        basis table and a defined complaints route.]
      </p>
    </LegalPage>
  )
}
