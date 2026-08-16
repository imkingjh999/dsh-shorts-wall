#!/usr/bin/env node
/**
 * Type-check using the TypeScript compiler bundled through tsdown. Keeping
 * that dependency transitive avoids a duplicate direct dev dependency while
 * still running the real tsc binary from the lockfile.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const tsdownPackage = require.resolve('tsdown/package.json')
const tsRequire = createRequire(tsdownPackage)
const tsc = tsRequire.resolve('typescript/bin/tsc')
const result = spawnSync(process.execPath, [tsc, '--noEmit'], {
  stdio: 'inherit',
  cwd: fileURLToPath(new URL('..', import.meta.url)),
})

process.exit(result.status ?? 1)
