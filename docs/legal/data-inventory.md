# What CrewTracker stores about people

Written 2026-09-16 from the live schema, not from memory. This is the factual
base for a privacy policy and for the terms — everything here is checkable
against `scripts/sql/schema.sql` and the tables themselves.

Operator: **Smith Audio, LLC**.

---

## The fact that shapes everything else

**Most of the people in this database never signed up.** A production company
adds its crew to a directory; those people get no account, never agree to
anything, and in most cases never see the app at all. The app then holds their
name, email, phone, pay rate and the hours they worked, and emails them.

That is normal for staffing software and it is not a problem in itself — but it
means the privacy policy cannot be written as if every data subject is a
customer. There are **three kinds of person** here and they have different
relationships to the company:

| | Who they are | How their data arrives | Do they have an account? |
|---|---|---|---|
| **Users** | Admins, schedulers, PMs, office staff | They signed up via an invitation | Yes |
| **Crew** | The people who work the shows | Typed in by somebody at the company | Usually no |
| **Clients** | The company's customers | A name on a show | No |

## Where it physically lives

| | Provider | Region | What it holds |
|---|---|---|---|
| Database | **Supabase** (project `nfrvxkwemtittrqboebl`) | **AWS us-east-2, Ohio, USA** | Everything below |
| Logins | **Supabase Auth** | same | Email, password hash, Google identity, sign-in times |
| Hosting and logs | **Vercel** | US default (no region pinned in `vercel.json`) | Request logs, server logs |
| Outbound email | **Resend** | US | Every recipient address and the full body of every message |
| Sign-in with Google | **Google** | — | Only if a user chooses it |
| DNS | **Netlify / NS1** | — | No personal data |

Nothing is stored in the EU or UK. Nothing is encrypted beyond what Supabase and
Vercel do at rest and in transit by default.

## What is stored, by person

### Users (people with a login)
- `profiles` — name, email, display preferences
- `auth.users` (Supabase) — email, password hash or Google identity, sign-in history
- `memberships` — which companies they belong to and 19 permission flags each
- `invitations` — the email an invite was sent to, and the permissions it carried
- Their fingerprints on records: `created_by`, `finalized_by`, `sent_to_scheduling_by`, `actor`

### Crew (usually no login)
- `crew_members` — **full name, email address, phone number, free-text notes**
- `rate_cards` — **what they are paid**, per role
- `timecards` — their name again, role, day rate, travel and absence flags
- `punches` — **every clock-in and clock-out**, to the minute, and whether they or a PM entered it
- `booking_invites` — the email an ask went to, their answer, and **a free-text note they wrote**
- `clock_links` — a token standing for them on one show
- `staffing_events` — a diary of their bookings, moves and releases

Punch data is **working-time data**. Several jurisdictions regulate how long it
must be kept and who may see it; nothing in the app enforces any of that today.

### Clients and venues
- `shows` — client company, venue, city, job number, free-text notes,
  and `final_report_recipients`, which is a list of email addresses

### Everyone who touches a public page
- `rate_limits` — **IP addresses**, e.g. `punch-ip:146.75.164.34`, from the three
  public routes (punch, identify, booking response). Purged daily by the
  keepalive cron, which is the only automatic deletion anywhere in the system.

## Who can see what, inside a company

Worth stating in the policy because it is unusually tight and it is a selling
point rather than an apology:

- **Pay rates are locked at the column.** `authenticated` holds no SELECT grant
  on `timecards.day_rate` or `rate_cards.day_rate`; reads go through two
  SECURITY DEFINER views that check `can_view_pay_rates` per query. A PM running
  a show genuinely cannot read the numbers.
- **No cross-company visibility, ever.** One login can belong to several
  companies; nothing about one surfaces in another, by construction.
- **A crew-side login sees only their own rows** — other people's timecards and
  punches do not exist for them at the database.
- Crew timesheets sent by text are **deliberately dollar-free**.

## Retention and deletion — the honest state

- **Nothing expires.** Shows can be archived; archiving hides, it does not delete.
- **There is no "delete my account".** Not for a user, not for a company.
- **There is no data export** for a customer who wants their records out.
- **A crew member cannot see, correct or remove their own record.** They have no
  account. The only thing they can reach is a clock link showing their own hours.
- **Deleting a crew member is possible from the directory** (`lib/crew.ts` nulls
  the foreign key first), but their name survives on `timecards.crew_member_name`
  and `staffing_events.crew_member_name`, which are denormalised copies.
- `rate_limits` is the sole exception: purged after a day.

**Backups**: `npm run db:dump` writes to `backups/`, which is git-ignored and
**syncs to Dropbox**. So a full copy of production personal data, including pay
rates and phone numbers, exists on Dan's machines and in Dropbox's storage. That
is a processor nobody has counted yet.

## What is NOT here

Worth saying explicitly, because it shortens the policy:

- No health data, biometrics, or anything in a special category
- No payment card data — Stripe is not integrated
- No location tracking; the QR clock records a time, not a place
- No analytics, no advertising, no third-party trackers, no cookie banner needed
  (cookies are first-party session only — see the cookie stance in CLAUDE.md)
- Nothing knowingly collected from children

## The gaps a lawyer will ask about

1. **No deletion path**, for anybody — the right most privacy regimes start with.
2. **No export path** for a customer's own data.
3. **Crew have no way to see or correct what is held about them**, and never
   agreed to it being held.
4. **Backups sync to Dropbox**, adding an uncounted processor and putting
   production personal data on personal machines.
5. **No retention limit on punch data**, which is regulated working-time data in
   some places.
6. **No data-processing agreement** with customers, who are arguably the
   controller while Smith Audio, LLC is the processor — that distinction decides
   who answers a crew member's request.
