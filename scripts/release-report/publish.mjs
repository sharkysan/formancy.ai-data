// npm receives exactly the tarballs the install gate installed and ran
// (0035). release.yml's `publish` job, after its `check` job passed them:
//
//   node scripts/release-report/publish.mjs --tarballs release-tarballs --report release-report/release-report.json
//
// with NODE_AUTH_TOKEN, NPM_CONFIG_PROVENANCE, RELEASE, VERSION and CHECKED --
// what `check` pinned -- set. Before the first `npm publish` it refuses, all
// at once, a downloaded file `check` did not pin or pinned otherwise, a report
// that is not this run's, green and whole, and a tarball whose sha256 is not
// the one the report says the install gate installed: the artefact store is
// written by every job of the run, and the step that holds the npm token
// takes nobody's word for what it was handed. Then, per tarball, in the order
// their own manifests' dependencies give -- data-core before what depends on
// it -- it asks the registry for that version:
//
//   - not there: `npm publish <file.tgz> --provenance --access public`;
//   - there with this tarball's sha512 as its `dist.integrity`: skipped, which
//     is what lets a failed publish job be run again after some versions
//     reached npm;
//   - there with any other integrity: refused. A version number is published
//     once, and those bytes are not these.
//
// Nothing is rebuilt and nothing is packed here: a tarball built in this job
// would be bytes no gate installed. `--access public` is the registry's
// visibility of a scoped package; LICENSE.md says what may be done with it.

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { readTarball } from './tarball.mjs'
import { downloadedProblems } from './verify-publish.mjs'

const FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies']

/** What npm records as a tarball's integrity, and the registry as its `dist.integrity`. */
export const integrityOf = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/**
 * The names of `packages` (`[{ name, manifest }]`), each after every other
 * one of them it depends on, ties in name order. Throws on a cycle, which
 * would be a release nobody can install in any order.
 */
export function publishOrder(packages) {
  const names = new Set(packages.map((entry) => entry.name))
  const needs = new Map(packages.map(({ name, manifest }) => [name, new Set(FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})).filter((dependency) => names.has(dependency) && dependency !== name))]))
  const order = []
  while (order.length < packages.length) {
    const ready = [...needs].filter(([name, deps]) => !order.includes(name) && [...deps].every((dependency) => order.includes(dependency))).map(([name]) => name).sort()
    if (ready.length === 0) throw new Error(`the tarballs depend on one another in a cycle: ${[...names].filter((name) => !order.includes(name)).join(', ')}`)
    order.push(ready[0])
  }
  return order
}

/**
 * What to do with a tarball, given the integrity the registry holds for its
 * version (`undefined` when it has none): `publish` or `skip`. Throws when
 * the registry holds other bytes under that version.
 */
export function decide({ name, version, integrity }, registered) {
  if (registered === undefined) return 'publish'
  if (registered === integrity) return 'skip'
  throw new Error(`${name}@${version} is on npm as ${registered}, not as this tarball's ${integrity}: a version is published once, and these are not its bytes`)
}

/**
 * The tarballs to publish, in the order they go in: `files` are what this job
 * downloaded, `[{ path, bytes }]`, the report's directory and the tarballs;
 * `checked` what `check` pinned of them; the rest this run's. Throws, naming
 * every problem, unless each file is what `check` pinned, the report is this
 * run's, green and whole, and each tarball is the one the report says the
 * install gate installed.
 */
export function toPublish({ files, report, checked, release, version, commit, runId }) {
  const problems = downloadedProblems({ checked, files, report, release, version, commit, runId })
  const gate = new Map((report.results?.install?.tarballs ?? []).map((entry) => [entry.file, entry]))
  const tarballs = files
    .filter(({ path }) => path.endsWith('.tgz'))
    .map(({ path, bytes }) => {
      const file = basename(path)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (gate.get(file)?.sha256 !== sha256) problems.push(`${file} is not the tarball the install gate installed and ran: sha256 ${sha256}, recorded ${String(gate.get(file)?.sha256)}`)
      const manifest = JSON.parse(readTarball(bytes).get('package/package.json')?.toString('utf8') ?? '{}')
      return { file, path, name: manifest.name, version: manifest.version, manifest, integrity: integrityOf(bytes) }
    })
  if (problems.length > 0) throw new Error(`publish.mjs publishes nothing:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`)
  return publishOrder(tarballs).map((name) => tarballs.find((entry) => entry.name === name))
}

/** The integrity npm holds for `name@version`, or undefined when the registry has no such version. */
function registered(name, version) {
  const answer = spawnSync('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'], { encoding: 'utf8' })
  if (answer.status !== 0) {
    if (/E404|404 Not Found/.test(`${answer.stdout}${answer.stderr}`)) return undefined
    throw new Error(`npm view ${name}@${version} failed: ${answer.stderr.trim()}`)
  }
  return answer.stdout.trim() === '' ? undefined : JSON.parse(answer.stdout)
}

// `node scripts/release-report/publish.mjs --tarballs <dir> --report <file>`
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/release-report/publish.mjs')) {
  const argv = process.argv.slice(2)
  const option = (name) => {
    const value = argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined
    if (value === undefined || value === '') throw new Error(`publish.mjs needs ${name}`)
    return value
  }
  for (const name of ['GITHUB_SHA', 'GITHUB_RUN_ID', 'RELEASE', 'VERSION']) if (!process.env[name]) throw new Error(`publish.mjs holds the report to this run, and ${name} is not set`)
  const reportFile = resolve(option('--report'))
  const inside = (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({ path: relative(process.cwd(), join(dir, entry.name)).replaceAll('\\', '/'), bytes: readFileSync(join(dir, entry.name)) }))
  const dir = resolve(option('--tarballs'))
  const order = toPublish({
    files: [...inside(dirname(reportFile)), ...inside(dir)],
    report: JSON.parse(readFileSync(reportFile, 'utf8')),
    checked: process.env.CHECKED,
    release: process.env.RELEASE,
    version: process.env.VERSION,
    commit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
  })
  for (const tarball of order) {
    if (decide(tarball, registered(tarball.name, tarball.version)) === 'skip') {
      console.log(`${tarball.name}@${tarball.version}: already on npm with these bytes, skipped`)
      continue
    }
    execFileSync('npm', ['publish', join(dir, tarball.file), '--provenance', '--access', 'public'], { stdio: 'inherit' })
    console.log(`${tarball.name}@${tarball.version}: published from ${tarball.file}`)
  }
}
