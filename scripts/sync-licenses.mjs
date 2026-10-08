// Put LICENSE.md and NOTICE inside every publishable package.
//
// The licence has to travel with the tarball, and here for the opposite reason
// Apache-2.0 makes formancy.ai do it. There, section 4(a) requires it. Here, a
// package found on npm under the @formancy scope with no terms inside it will be
// assumed to carry the scope's terms -- Apache-2.0 -- and a consumer who runs it
// in production on that assumption has been misled by the tarball. The
// `license` field says "SEE LICENSE IN LICENSE.md"; this is what makes that
// sentence true once the package is unpacked.
//
// NOTICE travels for the Apache reason: this product depends on Apache-2.0
// packages, and section 4(d) requires their notices to be preserved.
//
// Copied rather than committed so there is one source of truth: a change to the
// root LICENSE.md reaches every package on the next build instead of leaving
// stale copies behind. The copies are gitignored.
//
// npm always includes a file called LICENSE* in a tarball whatever `files`
// says; it does NOT do that for NOTICE, which is why NOTICE is listed in `files`.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sources = ['LICENSE.md', 'NOTICE']

for (const file of sources) {
  if (!existsSync(join(root, file))) throw new Error(`No ${file} at the repository root`)
}

const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, 'packages', entry.name))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .filter((dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).private !== true)

let written = 0
for (const dir of packages) {
  // A package that publishes from a subdirectory packs from there, so the files
  // have to land where the tarball is actually made from.
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const target = manifest.publishConfig?.directory
    ? join(dir, manifest.publishConfig.directory)
    : dir

  if (!existsSync(target)) {
    // The dist has not been built yet. Not an error: the build will call this
    // again, and packing an unbuilt package fails for its own reasons.
    continue
  }

  mkdirSync(target, { recursive: true })
  for (const file of sources) {
    copyFileSync(join(root, file), join(target, file))
    written += 1
  }
}

console.log(`licences: wrote ${String(written)} files across ${String(packages.length)} packages`)
