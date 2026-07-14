// One-off SQL runner against the Supabase Postgres database.
// Usage: node --env-file=.env.local scripts/run-sql.mjs path/to/file.sql
//
// Requires DATABASE_URL in .env.local (Supabase dashboard -> Project
// Settings -> Database -> Connection string -> "Transaction pooler" or
// "Direct connection"). Never commit that value or paste it into chat.

import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const sqlPath = process.argv[2]
if (!sqlPath) {
  console.error('Usage: node --env-file=.env.local scripts/run-sql.mjs <path-to-sql-file>')
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local first (see comment at top of this file).')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
  const result = await client.query(sql)
  const results = Array.isArray(result) ? result : [result]
  for (const r of results) {
    console.log(`${r.command || 'OK'} — ${r.rowCount ?? 0} row(s)`)
    if (r.rows?.length) console.table(r.rows)
  }
} catch (err) {
  console.error('SQL error:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
