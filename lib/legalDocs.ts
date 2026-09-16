// THE DOCUMENTS THEMSELVES, and the only copy of them.
//
// They live here rather than in docs/ because the app has to render them and
// Next's file tracing is not a thing to bet a legal page on. `npm run legal`
// writes docs/legal/DRAFT-*.md from these constants, so the file a lawyer reads
// and the page a customer reads cannot drift apart — the same bargain
// scripts/sql/schema.sql has with the database.
//
// Plain module, no 'use client'. DRAFTS: neither is in force, and the pages say
// so at the top in a way nobody can miss.

export const TERMS_MD = `# CrewTracker — Terms of Service

> **DRAFT — NOT IN FORCE. FOR A LAWYER TO REVIEW.**
> Written 2026-09-16 against what the software actually does
> (\`docs/legal/data-inventory.md\`). It has not been reviewed by anyone
> qualified, and it should not be published or accepted by a customer until it
> has. Blanks marked ⟨like this⟩ need Dan's answer.

**Effective ⟨date⟩.** CrewTracker is operated by **Smith Audio, LLC** ("we",
"us"). By using it you agree to these terms. If you are agreeing on behalf of a
company, you confirm you may bind that company.

## 1. What CrewTracker is

CrewTracker is software for production companies to schedule crew, record the
hours they work, and calculate what they are owed. It runs in a web browser.

## 2. It is in beta

CrewTracker is early software offered to a small number of companies while it is
still being built. That means:

- **Features will change**, and some will be removed.
- **It may be unavailable** without notice, and we do not promise any level of
  uptime.
- **We may end the beta**, or end your access to it, at any time. We will give
  you ⟨notice period — 30 days?⟩ and a way to get your data out before we do,
  except where we have to act immediately.
- **It is free during the beta.** If we introduce charges we will tell you before
  they start, and you may stop using it instead.

## 3. Accounts

Access is by invitation. Whoever holds an admin account in your company can
invite others and decide what each of them may do. You are responsible for who
you invite, for what you allow them to do, and for anything done using your
accounts. Tell us promptly if you think an account has been misused.

## 4. Your data, and the people in it

**You own what you put in.** We claim no ownership of your shows, your crew
records, or your hours.

**You are responsible for having the right to put it there.** CrewTracker holds
personal information about people who never signed up for it — your crew's
names, phone numbers, email addresses and pay rates. By entering that
information you confirm you are entitled to hold it and to let us process it on
your behalf, and that you have given those people whatever notice the law where
you operate requires.

**We act on your instructions.** For that crew data you are the controller and we
are the processor: we hold and process it to run the service for you, and not
for our own purposes. If one of your crew asks us what we hold about them, we
will normally tell them to ask you, and tell you they asked.

**We will not sell your data, or anyone's data in it, ever.**

## 5. What CrewTracker does not do — read this one

**CrewTracker calculates. You pay people.**

The software works out hours, overtime, double time, meal penalties, travel and
day rates from the rules you configure and the times that are entered. Those
calculations are a tool. They are **not** payroll advice, tax advice, or legal
advice, and they are not a substitute for your own checking.

**You remain responsible for paying your crew correctly** and for complying with
every wage, hour, overtime, break and record-keeping law that applies to you. You
are responsible for the rules you configure, for the accuracy of the times
recorded, and for reviewing the numbers before you pay anybody.

We are not liable for underpayment, overpayment, penalties, fines, claims or
disputes arising from your use of the calculations.

## 6. Using it properly

Do not: break the law with it; try to reach data belonging to another company;
probe or attack the service; scrape it; resell it; or upload anything malicious.
Do not use it to hold information about people you have no right to hold.

## 7. Our software stays ours

The software, its design and its name remain ours. Using CrewTracker does not
give you any rights in it beyond permission to use it while these terms are in
force. Feedback you send us we may use freely, without owing you anything for it.

## 8. Stopping

You may stop at any time. Ask us and we will give you your data in a
machine-readable form and then delete it, within ⟨30 days?⟩ — except anything we
have to keep by law, and copies sitting in routine backups, which age out.

We may suspend or end your access if you break these terms, if we have to for
legal or security reasons, or if we end the beta.

## 9. No warranty

CrewTracker is provided **as is** and **as available**, with no warranty of any
kind, express or implied, including any warranty of merchantability, fitness for
a particular purpose, accuracy, or non-infringement. We do not warrant that it
will be uninterrupted, error-free, or that any calculation it performs is
correct.

## 10. Limit of liability

To the fullest extent the law allows, Smith Audio, LLC is not liable for lost
profits, lost data, lost business, or any indirect, incidental, special or
consequential damages. Our total liability for any claim relating to CrewTracker
will not exceed ⟨the greater of what you paid us in the twelve months before the
claim, or US$100⟩.

Some states do not allow these limits; where that is so, they apply as far as
the law permits.

## 11. Indemnity

You will defend and indemnify us against claims arising from the data you put
into CrewTracker, from your use of it, or from your breach of these terms.

## 12. Changes

We may change these terms. If a change is significant we will tell you before it
takes effect. Continuing to use CrewTracker after that means you accept it.

## 13. Law

These terms are governed by the law of ⟨state — Texas?⟩, and any dispute will be
brought in the courts of ⟨county, state⟩. ⟨Lawyer: is arbitration wanted here, or
not? It is a real trade-off and Dan should choose knowingly.⟩

## 14. Reaching us

⟨contact email⟩ — Smith Audio, LLC, ⟨address⟩.
`

export const PRIVACY_MD = `# CrewTracker — Privacy Policy

> **DRAFT — NOT IN FORCE. FOR A LAWYER TO REVIEW.**
> Written 2026-09-16 from the live schema (\`docs/legal/data-inventory.md\`), so
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

⟨Lawyer: \`db:dump\` backups currently sync to Dropbox on Dan's own machines, which
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
`
