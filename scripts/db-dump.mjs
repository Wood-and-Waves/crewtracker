// Take a snapshot of the database with pg_dump.
//
//   npm run db:dump      full dump (schema + data) -> backups/, gitignored
//   npm run db:schema    schema only -> scripts/sql/schema.sql, committed
//
// WHY THIS EXISTS
// ---------------
// The 33 files in scripts/sql/ cannot rebuild this database: they're unordered,
// several supersede earlier ones, and nothing records which were applied. Until
// now the schema — 43 RLS policies, 17 functions, 12 triggers — existed in
// exactly one place, the live database, with no way to reproduce or restore it.
// scripts/sql/schema.sql produced by `db:schema` is the fix: one authoritative
// description of the database, and the thing a development project is built from.
//
// WHY A WRAPPER RATHER THAN A RAW pg_dump COMMAND
// -----------------------------------------------
// Two easy ways to get a silently useless backup, both caught here:
//   * pg_dump cannot run against the TRANSACTION pooler (port 6543) that
//     DATABASE_URL points at. It needs the SESSION pooler (port 5432), which is
//     why this insists on DATABASE_URL_SESSION and checks the port.
//   * libpq is keg-only on Homebrew, so pg_dump isn't on PATH by default.
//
// NOT COVERED: the `auth` schema (logins). That belongs to Supabase and isn't
// ours to dump — Supabase's own backups cover it.
//
// ALSO NOT COVERED, and easy to miss: **event triggers**. They're cluster-level,
// so `--schema=public` never sees them. Production runs `ensure_rls`, which
// force-enables RLS on every newly created table — the safety net that makes a
// forgotten policy fail closed. schema.sql alone will not reproduce it.
//
// RESTORING INTO A NEW PROJECT: turn OFF "Automatically expose new tables"
// first. Supabase implements it as ALTER DEFAULT PRIVILEGES for the `postgres`
// role, which is who a restore connects as — so every table arrives already
// holding a table-wide SELECT grant for `authenticated`. This dump expresses the
// day_rate lockdown as an *absence* (it grants each other column by name and
// never mentions day_rate) rather than as a REVOKE, and column grants don't
// remove a table-wide one. With the setting on, pay rates come back readable.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const schemaOnly = process.argv.includes('--schema-only')

// Homebrew keeps libpq keg-only, so look where it actually installs before
// falling back to whatever is on PATH.
const CANDIDATES = [
  '/opt/homebrew/opt/libpq/bin/pg_dump',   // Apple Silicon
  '/usr/local/opt/libpq/bin/pg_dump',      // Intel
  'pg_dump',
]

function findPgDump() {
  for (const c of CANDIDATES) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' })
      return c
    } catch { /* try the next one */ }
  }
  return null
}

const url = process.env.DATABASE_URL_SESSION
if (!url) {
  console.error(`
DATABASE_URL_SESSION is not set in .env.local.

pg_dump can't use DATABASE_URL — that's the transaction pooler (port 6543), which
doesn't support the session features a dump needs. Get the SESSION pooler string
from Supabase → Project Settings → Database → Connection string → Session pooler
(same host, port 5432) and add it to .env.local as DATABASE_URL_SESSION.
`)
  process.exit(1)
}

if (url.includes(':6543')) {
  console.error(`
DATABASE_URL_SESSION points at port 6543, which is the TRANSACTION pooler.
pg_dump needs the SESSION pooler — same host, port 5432.
`)
  process.exit(1)
}

const pgDump = findPgDump()
if (!pgDump) {
  console.error(`
pg_dump not found. Install it with:

  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  brew install libpq

No PATH changes needed — this script looks in Homebrew's libpq directory directly.
`)
  process.exit(1)
}

// --no-owner so a dump can be restored into a different Supabase project (the
// dev one) whose roles differ. Privileges ARE included deliberately: the
// column-level grants on timecards.day_rate are part of the security model.
const args = [
  url,
  '--schema=public',
  '--no-owner',
  '--quote-all-identifiers',
]
if (schemaOnly) args.push('--schema-only')

let out
if (schemaOnly) {
  out = join('scripts', 'sql', 'schema.sql')
} else {
  if (!existsSync('backups')) mkdirSync('backups')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  out = join('backups', `crewtracker-${stamp}.sql`)
}
args.push('--file', out)

// DATABASE_URL_SESSION is deliberately pinned to PRODUCTION even when the app
// and db:sql point at dev — a backup that silently captured fake data would be
// worse than no backup. Print the ref so that stays visible rather than assumed.
const ref = (url.match(/postgres\.([a-z0-9]+)/) || [])[1] ?? 'unknown'
console.log(`${schemaOnly ? 'Schema' : 'Full'} dump of ${ref} → ${out}`)
try {
  execFileSync(pgDump, args, { stdio: ['ignore', 'inherit', 'inherit'] })
} catch {
  console.error('\npg_dump failed. If it mentions authentication, re-copy the session pooler string.')
  process.exit(1)
}

const { statSync } = await import('node:fs')
console.log(`Done — ${(statSync(out).size / 1024).toFixed(0)} KB`)
if (!schemaOnly) console.log('backups/ is gitignored; keep a copy somewhere off this machine.')
