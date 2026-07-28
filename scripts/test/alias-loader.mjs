// Teaches plain Node the `@/` path alias, so the test scripts can import the
// app's own modules instead of a copy.
//
//   node --import ./scripts/test/alias-loader.mjs --experimental-strip-types <file>
//
// `@/lib/punches` is a TypeScript path alias configured in tsconfig.json. Next
// and tsc understand it; Node does not, and fails with ERR_MODULE_NOT_FOUND on
// a package literally named "@/lib". This hook rewrites the prefix to a real
// file URL before resolution.
//
// The point of the indirection is that tests exercise lib/payroll.ts *itself* —
// the file that decides what people get paid. Duplicating the arithmetic into a
// test fixture would produce a suite that passes while the real thing is wrong,
// which is worse than no suite.

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const ROOT = pathToFileURL(process.cwd() + '/')

register('data:text/javascript,' + encodeURIComponent(`
  const ROOT = ${JSON.stringify(ROOT.href)};
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
      // Extensionless in source; try .ts then .tsx, then leave it to Node.
      const base = ROOT + specifier.slice(2);
      for (const ext of ['.ts', '.tsx', '']) {
        try { return await next(base + ext, context); } catch { /* try the next */ }
      }
    }
    return next(specifier, context);
  }
`), import.meta.url)
