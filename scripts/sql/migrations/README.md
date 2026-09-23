# Migrations

Applied by `npm run db:migrate`, in filename order, exactly once per database.

    npm run db:migrate                 apply pending to dev
    npm run db:migrate -- --status     list applied and pending
    npm run db:migrate -- --prod       apply pending to production

## Writing one

Name it `NNNN_short_description.sql`, taking the next number. Filename order is
apply order, so the number is the only thing that decides sequencing.

Each file runs inside a transaction and is recorded with a checksum of its
contents. If a statement cannot run in a transaction — `create index
concurrently`, for example — put `-- migrate:no-transaction` on the very first
line, and be aware the file is then responsible for its own cleanup if it fails
partway.

## Creating a table? Grant it in the same file

**From 30 October 2026 Supabase stops handing new tables to the Data API on its
own.** Until then, `ALTER DEFAULT PRIVILEGES` in `public` gave `anon`,
`authenticated` and `service_role` every privilege on a table the moment it was
created, so a migration could create one and it simply worked. After that date a
table with no explicit grant is unreachable through supabase-js / PostgREST, and
the error is `permission denied` at runtime rather than anything the migration
itself reports.

So say it out loud, in the migration that creates the table:

    grant select, insert, update, delete on public.your_table to authenticated;
    grant select, insert, update, delete on public.your_table to service_role;

Grant only what the table actually needs, not the whole list — RLS decides the
rows, but the grant decides whether the role may reach the table at all, and a
privilege nobody uses is one more thing to reason about later. `anon` is almost
never right here: the public routes in this app read with the SERVICE role
behind a token, not as `anon`.

`service_role` is the one that gets forgotten, because nothing in the app ever
fails in development without it — the default privileges were covering it. It is
what the crew clock, the digest and every admin route run as.

Then **`npm run db:grants`** after the migration reaches production, so
`scripts/sql/grants.sql` learns the new table. That file is what rebuilds a
database's privileges from scratch, and a table missing from it comes back
unreachable.

## The one rule

**Never edit a migration that has been applied.** The runner records a checksum
and will refuse to continue if the file changes afterwards. This is not
bookkeeping fussiness: the database still holds whatever the original version
did, and editing the file cannot undo that — it only removes the evidence that
the two disagree. Write a new migration.

## Workflow

Write it, run it against dev, verify the effect, then `--prod`. Dev exists so
production is never the first place a migration runs.
