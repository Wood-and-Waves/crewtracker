import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service — CrewTracker',
  description: 'The terms under which CrewTracker may be used, including the payroll calculation disclaimer.',
}

// The clause that actually matters here is "Payroll calculations are yours to
// check". CrewTracker computes what people get paid, from rules the customer
// configures — overtime thresholds, meal penalties, short-turnaround rules — and
// those rules are contractual and jurisdictional, not universal. If a customer
// misconfigures a ruleset and underpays a crew member, that is a wage dispute
// with real legal consequences, and the terms need to be unambiguous that
// verifying the output is the customer's job. Everything else on this page is
// ordinary; that clause is the one to have a lawyer read closely.

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="27 July 2026">
      <p>
        These terms cover your use of CrewTracker, a tool for tracking crew hours and calculating
        payroll for live events. By creating an account or using the service, you agree to them.
        If you are agreeing on behalf of a company, you confirm you are authorised to do so.
      </p>

      <h2>1. The service is in beta</h2>
      <p>
        CrewTracker is under active development and is currently offered to a limited set of
        invited companies. Features may change, move or be withdrawn, and occasional interruptions
        should be expected. Please do not treat it as your only record of anything you cannot
        afford to lose — export your reports.
      </p>

      <h2>2. Accounts</h2>
      <p>
        Accounts are created by invitation. You are responsible for keeping your login details
        secure and for everything done under your account. Tell us promptly if you believe someone
        else has gained access.
      </p>
      <p>
        Administrators within your organisation control who is invited and what each person may
        do. If you grant someone permission to view pay rates, export reports or manage users, you
        are responsible for that decision.
      </p>

      <h2>3. Payroll calculations are yours to check</h2>
      <p>
        <strong>
          CrewTracker performs arithmetic based on the punch times you enter and the payroll rules
          you configure. It does not know your obligations and cannot verify them.
        </strong>
      </p>
      <p>
        Overtime thresholds, double-time rules, meal penalties, short-turnaround penalties, travel
        pay and half-day rates all vary by jurisdiction, by union agreement and by individual
        contract. You choose those settings. We do not provide legal, tax, accounting or payroll
        advice, and nothing the software produces is a substitute for it.
      </p>
      <p>
        You remain responsible for paying your crew correctly and for complying with all
        applicable wage, hour, tax and employment laws. Check the figures before you pay anyone
        against them.
      </p>

      <h2>4. Your data stays yours</h2>
      <p>
        You keep ownership of everything you put into CrewTracker — your shows, crew records,
        times and rates. You grant us permission to store and process that information only as
        needed to run the service for you, as described in our{' '}
        <a href="/privacy">Privacy Policy</a>. We do not sell it and we do not use it to train
        anything.
      </p>
      <p>
        You are responsible for having a proper basis to record the crew details you enter, and
        for telling those people how their information is used where you are required to.
      </p>

      <h2>5. Acceptable use</h2>
      <ul>
        <li>Do not use CrewTracker for anything unlawful, or to store information you have no right to hold.</li>
        <li>Do not attempt to access another organisation&rsquo;s data, or probe, scan or interfere with the service.</li>
        <li>Do not share an account between people — invite them properly instead.</li>
        <li>Do not resell or rebrand the service without our written agreement.</li>
      </ul>
      <p>
        If you find a security flaw, please tell us rather than exploit it. We will not pursue
        anyone who reports a genuine issue in good faith and gives us a reasonable chance to fix
        it.
      </p>

      <h2>6. Availability</h2>
      <p>
        We aim to keep CrewTracker running and available, but during beta we do not offer a
        guaranteed uptime commitment. We may perform maintenance, sometimes at short notice.
      </p>

      <h2>7. Fees</h2>
      <p>
        CrewTracker is currently provided free of charge to beta participants. If we introduce
        paid plans we will give existing customers reasonable notice before any charge applies,
        and you will be able to decline and export your data.
      </p>

      <h2>8. Ending your use</h2>
      <p>
        You may stop using CrewTracker at any time and ask us to close your organisation&rsquo;s
        account. We may suspend or close an account that breaches these terms, or that puts the
        service or other customers at risk. Where we do, we will tell you why and give you a
        reasonable opportunity to export your data unless the circumstances make that
        inappropriate.
      </p>

      <h2>9. Disclaimers and liability</h2>
      <p>
        CrewTracker is provided &ldquo;as is&rdquo;. To the fullest extent the law allows, we
        exclude implied warranties, including that the service will be uninterrupted, error-free
        or fit for a particular purpose.
      </p>
      <p>
        To the fullest extent the law allows, we are not liable for lost profits, lost data, or
        indirect or consequential losses, and our total liability arising from your use of
        CrewTracker is limited to the greater of the amount you paid us in the twelve months
        before the claim, or one hundred US dollars.
      </p>
      <p>
        Nothing here excludes liability that cannot lawfully be excluded, such as for fraud or
        for death or personal injury caused by negligence.
      </p>

      <h2>10. Changes to these terms</h2>
      <p>
        We may update these terms as the service develops. We will change the date at the top and,
        for material changes, notify account holders by email. Continuing to use CrewTracker after
        a change means you accept the updated terms.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about these terms:{' '}
        <a href="mailto:hello@contact.crewtracker.app">hello@contact.crewtracker.app</a>.
      </p>
      <p className="text-xs">
        [To confirm before publishing: the legal entity name and address of the business operating
        CrewTracker, which country and state&rsquo;s law governs these terms and where disputes are
        heard, and whether the liability cap above is appropriate once there are paying customers.]
      </p>
    </LegalPage>
  )
}
