# How CrewTracker protects your data

*Last verified 27 July 2026 against the live system.*

CrewTracker holds information that production companies are right to be careful
about: crew names and phone numbers, day rates, and a record of who worked which
hours. This document explains how that information is kept separate, who can see
what, and — just as importantly — what we do not yet claim.

It is written to be checkable. Every statement below describes a control that is
actually in place, and the last section explains how each one was tested.

---

## The short version

- **One company's data is invisible to another.** Separation is enforced by the
  database on every single request, not by the app remembering to ask.
- **Pay rates are locked down further than anything else.** Someone without
  permission to see rates cannot read them at all — not through the app, and not
  by any other route.
- **A production manager can run a show and submit payroll without ever seeing
  what anyone earns.**
- **We collect no analytics and run no tracking of any kind.**
- **We are a young product.** We hold no formal security certifications and have
  not yet had an independent penetration test.

---

## Separation between companies

Every table that holds your information carries an access policy that checks
which organisation the person asking belongs to. There are **17 tables and 44
access policies**, and **no table is left without protection**.

The important detail is *where* the check happens. It is applied by PostgreSQL
itself, underneath the application. A request for another company's shows does
not return a filtered list or an error message — it returns nothing, because the
rows are never visible to that request in the first place. A bug in the
application cannot expose them, because the application is not the thing doing
the filtering.

Membership is re-checked on every request rather than trusted from the login
token. If someone's access is removed, it stops working on their next action —
not at their next sign-in.

## Pay rates

This is the control we would most like you to scrutinise, because it is the one
most products get wrong.

It is common for an application to *hide* salary figures from users who should
not see them, while the data is still sitting in the response, readable by anyone
who looks. That is a presentation choice, not a protection.

In CrewTracker, the right to read a day rate is **not granted at the database
level** to signed-in users. There is no permission to select that column. When
someone who is allowed to see rates asks for them, the request goes through a
separate checked route that confirms their permission at the moment of asking.

The practical consequence: a production manager without rate permission gets a
hard refusal from the database if a rate is requested by any means. They can
still do their job — staffing crew, recording punches, running the show — because
those actions are permitted; only reading the figures is not.

**This is what makes the end-of-show report possible.** A PM can finalise a show
and send the complete payroll report, including every dollar amount, to the
people you nominate — without those figures ever passing through their screen.

## Who can do what

Each person's access is controlled by **18 individual permissions**, set by an
administrator at your company. They cover crew details, viewing pay rates,
editing pay rates, payroll rules, reports, exporting, sending reports, and user
management.

These are real boundaries, not menu items. Turning off "create shows" means the
database refuses to create a show for that person, whatever route the attempt
takes.

Removing someone from your team cuts their access immediately and completely,
while keeping the historical record of what they did — so "who finalised this
payroll report" survives them leaving.

## Locked shows

Once a show's final report has been sent, its times are locked. Further changes
to punches or timecards are refused by the database, so a payroll record cannot
be quietly altered after it has been signed off and distributed. An administrator
can deliberately unlock a show if something genuinely needs correcting.

## Signing in

Accounts are created by invitation only. There is no public sign-up, so nobody
can create themselves an account on your organisation.

Passwords are handled by our authentication provider and stored only as secure
one-way hashes. We never see or store the password itself. You may sign in with
Google instead, in which case no password exists at all. Sessions expire and are
renewed automatically; signing out ends them.

## Where your data lives

All information is stored and processed in the **United States**, encrypted in
transit and at rest.

We use three service providers, each doing one job:

| Provider | Role |
|---|---|
| Supabase | Database and sign-in |
| Vercel | Hosting the application |
| Resend | Sending email (payroll reports, account email) |

Google is involved only if you choose to sign in with a Google account.

That is the complete list. Your data is not sent anywhere else.

## What we do not collect

CrewTracker contains **no analytics, no advertising pixels and no third-party
tracking scripts**. This is not a policy position we are asking you to trust — the
application has seven third-party components in total, and none of them is an
analytics tool.

A consequence you will notice: there is no cookie banner, because the only cookie
we set is the one that keeps you signed in.

We do not sell your information, share it for advertising, or use it to train
machine-learning models.

## Backups

Our database provider takes automated backups. We additionally take our own full
snapshots of the database, kept independently of the hosting environment, so a
restore does not depend on a single provider being available.

We can also rebuild the entire database structure from version-controlled
definitions, and that rebuild is tested rather than assumed — it is how our
development environment is created, and it has been verified to reproduce the
live system exactly.

## How all of this was checked

Access rules can look correct and behave differently. Everything above was tested
against the **live production system** using real, authenticated sessions rather
than by reading the configuration:

- Each account was exercised in turn and confirmed to see only its own company's
  shows and crew — and specifically **not** the others' (29 checks, all passed).
- Reading a pay rate directly was attempted from a signed-in session, including
  as an administrator, and was **refused by the database every time**.
- The permission-checked route returned rates for the users entitled to see them
  and nothing for the user who is not.
- Access without signing in returned nothing from any table.
- Turning off an individual permission was confirmed to block exactly the
  corresponding action and nothing else.

## What we do not claim

We would rather be straightforward about the limits than have you discover them.

- **No formal certifications.** CrewTracker is not SOC 2, ISO 27001 or HIPAA
  certified. If you need a certified vendor, we are not one yet.
- **No independent penetration test.** Our testing is thorough and evidence-based,
  but it has not been reviewed by an external security firm.
- **No two-factor authentication yet.** Accounts are protected by a password or by
  Google sign-in. 2FA is planned.
- **No formal uptime guarantee.** We are in beta and do not currently offer a
  contractual service level.
- **Small team.** CrewTracker is built and operated by a very small team. That
  means fast fixes and direct contact, but not a 24-hour security operations
  centre.
- **Crew do not have their own logins yet.** Crew information is entered and
  controlled by your company. If crew accounts are added in future, we will
  update this document before that ships.

## Reporting a problem

If you believe you have found a security issue, please write to
**hello@contact.crewtracker.app** with enough detail to reproduce it. We will
acknowledge it, keep you informed, and we will not pursue anyone who reports a
genuine issue in good faith and gives us a reasonable chance to fix it.

---

*This document describes CrewTracker as of the date at the top. It is kept
current with the software; if a control described here changes, this page changes
with it.*
