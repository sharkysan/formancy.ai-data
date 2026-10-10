// Whether the published performance figures describe this product (0034).
//
//   node scripts/performance-stale.mjs              exit 1 naming every difference
//   node scripts/performance-stale.mjs --describe   the product as JSON, for the measurement to record
//
// The release runs it before anything else, so a release whose measured code,
// runtime dependencies or build inputs differ from what docs/performance.md
// was measured on is refused until somebody re-measures (RELEASING.md). It
// compares content digests, not a commit range: a squash merge removes the
// branch's commits from main's history.
//
// A command and nothing else, with no check of whether it is the main module:
// that check compared the script's real path with the path it was invoked by,
// so run through a symlink it did nothing and exited 0, and the release gate
// was off. What the tests import lives in `performance-product.mjs`, and
// `performance-stale.test.mjs` runs this file as the release does.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareProduct, describeProduct } from './performance-product.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const RESULTS = 'docs/performance/results.json'

if (process.argv[2] === '--describe') {
  process.stdout.write(`${JSON.stringify(describeProduct(root), null, 2)}\n`)
} else {
  if (!existsSync(join(root, RESULTS))) {
    console.error(`${RESULTS} does not exist: no figures have been published. Run "pnpm performance" on a quiet Linux machine.`)
    process.exit(1)
  }
  const problems = compareProduct(JSON.parse(readFileSync(join(root, RESULTS), 'utf8')).product, describeProduct(root))
  if (problems.length > 0) {
    console.error(`docs/performance.md was measured on a different product. Re-measure ("pnpm performance" on a quiet Linux machine, RELEASING.md):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log('The published performance figures describe this product.')
}
