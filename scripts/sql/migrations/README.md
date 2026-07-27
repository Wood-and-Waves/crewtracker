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

## The one rule

**Never edit a migration that has been applied.** The runner records a checksum
and will refuse to continue if the file changes afterwards. This is not
bookkeeping fussiness: the database still holds whatever the original version
did, and editing the file cannot undo that — it only removes the evidence that
the two disagree. Write a new migration.

## Workflow

Write it, run it against dev, verify the effect, then `--prod`. Dev exists so
production is never the first place a migration runs.
