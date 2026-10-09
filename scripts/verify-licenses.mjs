// Refuse to publish a tarball that does not carry its licence, or that claims
// the wrong one.
//
// scripts/sync-licenses.mjs puts LICENSE.md and NOTICE where each package packs
// from. This checks that it worked, because the failure is silent otherwise:
// `npm publish` is perfectly happy to ship a tarball with neither, and the first
// person to notice is whoever audits the dependency months later.
//
// The `license` field is checked too, and that is the part formancy.ai's
// version of this script does for a different reason. There, every package is
// Apache-2.0 and a field saying otherwise is a mistake. Here, the packages share
// the @formancy scope with eleven Apache-2.0 packages and are NOT Apache-2.0,
// so a manifest that said so -- copied from upstream, say, which is how every
// manifest in this repository started -- would publish a commercial package
// under an open-source declaration. 0001 names this script as what holds the
// line, and `pnpm check:pkg` does not check a licence value at all.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/** What every tarball carries beside its code: the terms, and the notices of what it depends on. */
export const LICENSE_FILES = ['LICENSE.md', 'NOTICE']
const required = LICENSE_FILES

/** What every publishable manifest declares. The terms themselves are in the file it names. */
export const LICENSE_FIELD = 'SEE LICENSE IN LICENSE.md'

// The checks run when this is the script Node was asked to run, and not when
// another module imports LICENSE_FIELD from it: verify-publish.mjs (0035)
// holds a release's tarballs to the same field, from the same constant.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/verify-licenses.mjs')) {
  const problems = []
  let checked = 0

  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const dir = join(root, 'packages', entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.private === true) continue

    // Wherever the tarball is actually made from.
    const packRoot = manifest.publishConfig?.directory
      ? join(dir, manifest.publishConfig.directory)
      : dir

    checked += 1

    if (manifest.license !== LICENSE_FIELD) {
      problems.push(`${manifest.name}: license is ${String(manifest.license)}, expected "${LICENSE_FIELD}"`)
    }

    for (const file of required) {
      if (!existsSync(join(packRoot, file))) {
        problems.push(`${manifest.name}: no ${file} where it packs from`)
      }
    }

    // npm always includes LICENSE* whatever `files` says. It does not do that for
    // NOTICE, so a `files` array that omits it would drop it from the tarball
    // even though the file is sitting right there. LICENSE.md is required in the
    // list too, so the manifest says what ships rather than relying on npm's
    // special case.
    for (const file of required) {
      if (Array.isArray(manifest.files) && !manifest.files.includes(file)) {
        problems.push(`${manifest.name}: "files" does not list ${file}, so it will not be packed`)
      }
    }
  }

  if (problems.length > 0) {
    console.error('Licence check failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  console.log(`licences: ${String(checked)} publishable packages carry LICENSE.md and NOTICE and declare the right terms`)
}
