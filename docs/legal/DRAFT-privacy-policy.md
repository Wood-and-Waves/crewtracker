# CrewTracker — Privacy Policy

> **DRAFT — NOT IN FORCE. FOR A LAWYER TO REVIEW.**
> Written 2026-09-16 from the live schema (`docs/legal/data-inventory.md`), so
> every claim below is checkable against the software. It has not been reviewed
> by anyone qualified. Blanks marked ⟨like this⟩ need Dan's answer.
>
> **Where the software does not yet do what this says**, the line is marked
> ⚠ BUILD. Those are promises, and a policy that promises what the code cannot do
> is worse than no policy.

**Effective ⟨date⟩.** CrewTracker is operated by **Smith Audio, LLC**.

## Three kinds of people, and why that matters

Most privacy policies address a reader who signed up. Most of the people in
CrewTracker never did, so this one is honest about that from the start.

- **Users** — admins, schedulers, production managers and office staff who have
  a login. They were invited by their company.
- **Crew** — the people who work the shows. **Usually no login.** A production
  company adds them so it can book them and record their hours.
- **Clients** — the companies our customers work for. Only a name on a show.

If you are **crew** and you are reading this because you got an email from us:
the production company that booked you put your details in, we hold them on that
company's behalf, and the section "If you are crew" below is the one for you.

## What we hold

**If you have a login:** your name, your email address, your password (stored
only as a cryptographic hash, never readable) or your Google sign-in if you use
it, your display preferences, which companies you belong to and what you are
allowed to do in each.

**If you are crew:** your name, and whatever else the company entered — email
address, phone number, and any notes they wrote. What they pay you per day, per
role. Which shows and which days you are booked on, and whether you accepted.
Every clock-in and clock-out recorded for you, and whether you or a manager
entered it.

**About the companies' clients:** a company name, venue, city and job number on a
show.

**About anyone who opens a public page** (a clock link, a booking request): your
IP address, briefly, so that nobody can hammer those pages. It is deleted after
a day.

**We do not collect** health information, biometrics, payment card details,
location, or anything about children. We run **no analytics and no advertising
trackers**, and we set no cookies except the ones that keep you signed in.

## Why we hold it

To run the service the company is paying for: to book crew, to record hours, to
work out pay, and to send the emails and texts that make that happen. That is
all. **We do not sell personal information, and we do not share it for
advertising.**

## Who else touches it

| | What they do | Where |
|---|---|---|
| **Supabase** | Stores the database and handles logins | AWS US East (Ohio) |
| **Vercel** | Runs and hosts the application | United States |
| **Resend** | Delivers our email | United States |
| **Google** | Only if you choose "Sign in with Google" | — |

All data is stored in the **United States**. We do not use these companies for
anything but running CrewTracker.

⟨Lawyer: `db:dump` backups currently sync to Dropbox on Dan's own machines, which
makes Dropbox an uncounted processor and puts production data on personal
devices. Either it goes in this table or the practice changes. Recommend the
practice changes.⟩

## How long

While the company using CrewTracker keeps its account, we keep its records —
shows, crew, hours — because that is what the service is for and payroll records
need to last.

When a company leaves, we delete its data within ⟨30 days⟩, except anything the
law requires us to keep, and copies in routine backups which age out. ⚠ BUILD —
there is no deletion path in the software today; this is done by hand on request.

IP addresses used for rate limiting are deleted after a day. That happens
automatically.

## What a company can ask for

Ask us and we will give you a copy of your data in a machine-readable form, or
delete it. ⚠ BUILD — both are done by hand today.

## If you are crew

You did not sign up, and we know it. Here is where you stand:

- **You can see your own hours.** The clock link the company sent you shows every
  day of yours on that show, your breaks and your overtime — and it keeps
  working after the show is over.
- **You cannot log in**, because there is no account to log into.
- **To see, correct or remove what is held about you**, ask the production
  company that booked you. They entered it and they control it; we hold it for
  them. If you ask us instead, we will point you at them and tell them you asked.
- **If you cannot reach them, or they will not act**, write to us at ⟨contact
  email⟩ and we will help as far as we are able.

## Your rights

Depending on where you live you may have the right to know what is held about
you, to get a copy, to have it corrected or deleted, and not to be discriminated
against for asking. ⟨Lawyer: does the CCPA apply at this size? Does anything
state-level bite in ⟨state⟩? Please pin this section properly — it is the one
most likely to be wrong in a draft.⟩

## Security

Data is encrypted in transit and at rest by our providers. Inside a company,
access is restricted by role at the database itself, not merely hidden in the
interface: **pay rates in particular are locked so that managers who are not
permitted to see them cannot read them at all**, and nothing about one company is
ever visible to another.

We cannot promise any system is perfectly secure. If a breach affects your
information we will tell you and the authorities as the law requires.

## Children

CrewTracker is for businesses. We do not knowingly collect anything about anyone
under ⟨16? 13?⟩. If we learn that we have, we will delete it.

## Changes

If we change this policy we will post the new version and update the date. If a
change is significant we will tell the companies using CrewTracker directly.

## Reaching us

⟨contact email⟩ — Smith Audio, LLC, ⟨address⟩.
