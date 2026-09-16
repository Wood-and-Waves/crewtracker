// Write the lawyer's copy from the app's copy, so the two cannot drift.
//   npm run legal
import { writeFileSync } from 'node:fs'
import { TERMS_MD, PRIVACY_MD } from '../lib/legalDocs.ts'

const files: [string, string][] = [
  ['docs/legal/DRAFT-terms-of-service.md', TERMS_MD],
  ['docs/legal/DRAFT-privacy-policy.md', PRIVACY_MD],
]
for (const [path, body] of files) {
  writeFileSync(path, body)
  console.log(`wrote ${path} — ${body.split('\n').length} lines`)
}
