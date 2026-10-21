// What a release checks before anything permanent happens (0035), in
// release.yml's `check` job, which holds `contents: read` and no secret, and
// again in its `publish` job, before anything is signed or sent:
//
//   verify-publish.mjs --stage content --report release-report/release-report.json \
//     --tarballs release-tarballs --notes release-report/RELEASE_NOTES.md --release <r> --version <v>
//   verify-publish.mjs --stage sbom --report release-report/release-report.json --sbom <file> --installed <package-lock.json>
//   verify-publish.mjs --stage downloads --report ... --tarballs ... --notes ... --sbom ... --release <r> --version <v>
//
// `content` refuses, a sentence each: a report with problems, a partial or
// local one, or one of another commit, run, release or version; tarballs that
// are not exactly one per published package, or not byte for byte the ones
// the install gate installed and ran; a tarball without its licence files,
// with the wrong licence field, or at another version than the release's; and
// a release body that is missing or longer than GitHub accepts. It then pins
// what it checked: the sha256 of every file of the report's directory and of
// every tarball, as the step's output `checked`. It runs before cdxgen, whose
// dependencies nothing locks, so what it pins is what the gates uploaded.
//
// `sbom` refuses an SBOM that is not the inventory of the install it was
// made from -- the published tarballs, installed by npm as a consumer
// installs them (0092): one that names a package that install does not
// hold, or leaves out one it holds, by npm's lockfile of it; and one that
// leaves out a driver, a package this release publishes at its version, or
// an upstream package their install brings, or that gives a published
// package -- or the dependency that declares a nested one, tedious under
// mssql -- a runtime dependency at another version than its suites loaded,
// read from the SBOM's dependency graph. It pins the SBOM the same way.
//
// `downloads`, in the publish job, refuses any file it downloaded that is not
// byte for byte one `check` pinned, any pinned file it did not download, and
// a report that is not this run's, green and whole. publish.mjs applies the
// same to the report and the tarballs again before its first `npm publish`.
// Every job of a run can write to the run's artefacts, `check` included, so
// the pin is what ties what is published to what was checked.

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { BODY_LIMIT } from '../release-notes.mjs'
import { LICENSE_FIELD, LICENSE_FILES } from '../verify-licenses.mjs'
import { readTarball } from './tarball.mjs'

/**
 * The drivers: what talks to a customer's database, which an SBOM must name.
 * Only whether the SBOM names them at all; the version of every runtime
 * dependency it names is held to the report's, these and every other.
 */
export const DRIVERS = ['postgres', 'mssql']

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** A package of TypeScript declarations alone: no code of it runs, and cdxgen's --required-only leaves it out, so the SBOM's checks ask nothing of one (0092). */
const typesOnly = (name) => String(name).startsWith('@types/')

/** A package URL's npm name and version: `pkg:npm/%40formancy/spec@0.3.0?x` is `@formancy/spec`, `0.3.0`. */
export function npmPurl(purl) {
  const match = /^pkg:npm\/((?:%40|@)?[^@?#]+)@([^?#]+)/.exec(String(purl ?? ''))
  return match === null ? undefined : { name: decodeURIComponent(match[1]), version: decodeURIComponent(match[2]) }
}

/** What the release checks of one tarball: its bytes' sha256, its manifest's name, version and licence, and the licence files it carries. */
export function describeTarball(file, bytes) {
  const entries = readTarball(bytes)
  const manifest = JSON.parse(entries.get('package/package.json')?.toString('utf8') ?? '{}')
  return {
    file,
    sha256: sha256(bytes),
    name: manifest.name ?? null,
    version: manifest.version ?? null,
    license: manifest.license ?? null,
    carries: LICENSE_FILES.filter((name) => entries.has(`package/${name}`)),
  }
}

/** The report itself: green, whole, and of this commit, run, release and version. */
export function reportProblems(report, { release, version, commit, runId }) {
  const problems = []
  if (report.local === true) problems.push('the report is a local one, and a release reads only the report its own gates built')
  if (Array.isArray(report.partial) && report.partial.length > 0) problems.push(`the report is partial: ${report.partial.join(', ')} allowed missing`)
  if (!Array.isArray(report.problems)) problems.push('the report lists no problems at all, not even none')
  else if (report.problems.length > 0) problems.push(`the report has ${String(report.problems.length)} problem(s), the first: ${report.problems[0]}`)
  const subject = report.subject ?? {}
  if (subject.commit !== commit) problems.push(`the report is of commit ${String(subject.commit)}, not ${commit}`)
  if (String(subject.run?.id) !== String(runId)) problems.push(`the report is of run ${String(subject.run?.id)}, not this run, ${String(runId)}`)
  if (subject.release !== release) problems.push(`the report is of the release ${String(subject.release)}, not ${release}`)
  if (subject.version !== version) problems.push(`the report is of version ${String(subject.version)}, not ${version}`)
  return problems
}

/** The tarballs: one per published package, each the install gate's by sha256, each at the release's version, each carrying its licence. */
function tarballProblems(report, tarballs, version) {
  const problems = []
  const published = (report.results?.buildIdentity ?? []).map((entry) => entry.package).sort()
  const installed = new Map((report.results?.install?.tarballs ?? []).map((entry) => [entry.name, entry]))
  for (const name of published) {
    const count = tarballs.filter((tarball) => tarball.name === name).length
    if (count !== 1) problems.push(`${name}: ${String(count)} tarballs, where a release publishes exactly one`)
  }
  for (const tarball of tarballs) {
    if (!published.includes(tarball.name)) {
      problems.push(`${tarball.file} is ${String(tarball.name)}, which is no published package`)
      continue
    }
    const gate = installed.get(tarball.name)
    if (gate === undefined) problems.push(`${tarball.file}: the install gate recorded no tarball of ${tarball.name}`)
    else if (gate.sha256 !== tarball.sha256 || gate.file !== tarball.file) problems.push(`${tarball.file} has sha256 ${tarball.sha256}, not that of the ${gate.file} the install gate installed and ran, ${gate.sha256}`)
    // One number for every package (bump.mjs): the tag job reads data-core's
    // manifest only, so a package at another version is found here or on npm.
    if (tarball.version !== version) problems.push(`${tarball.file} is ${tarball.name} ${String(tarball.version)}, where this release is ${version}`)
    for (const name of LICENSE_FILES) if (!tarball.carries.includes(name)) problems.push(`${tarball.file} carries no package/${name}`)
    if (tarball.license !== LICENSE_FIELD) problems.push(`${tarball.file} declares the licence ${String(tarball.license)}, not "${LICENSE_FIELD}"`)
  }
  return problems
}

/**
 * The SBOM's dependency graph: each package's `name@version` to the
 * packages, `{ name, version }`, it depends on. cdxgen writes each
 * reference as the package's URL.
 */
function dependencyGraph(sbom) {
  const graph = new Map()
  for (const { ref, dependsOn } of sbom?.dependencies ?? []) {
    const from = npmPurl(ref)
    if (from !== undefined) graph.set(`${from.name}@${from.version}`, (dependsOn ?? []).map(npmPurl).filter((to) => to !== undefined))
  }
  return graph
}

/**
 * The SBOM against the report (0092): both drivers named; every package this
 * release publishes named at its version; every upstream package the report
 * marks shipped -- one a consumer's install of the published packages
 * brings -- named, and every upstream package it names at a version the
 * suites loaded; and each runtime dependency held where it is given, read
 * from the SBOM's dependency graph: a published package given each it
 * declares, and a nested one given by the dependency that declares it, at
 * the version the suites loaded or the install gate's clean install of the
 * same tarballs resolved in this run. A consumer's tree can hold one name at two
 * versions, the other brought by a dependency of a dependency no suite's
 * record names, so a runtime dependency is never held by its name alone
 * (formancy.ai-report 0017).
 */
export function sbomProblems(report, sbom) {
  const problems = []
  const components = (sbom?.components ?? []).map((component) => npmPurl(component.purl)).filter((entry) => entry !== undefined)
  const names = (name, version) => components.some((component) => component.name === name && (version === undefined || component.version === version))
  const runtime = report.testedOn?.runtime ?? []
  const upstream = report.testedOn?.upstream ?? []
  const version = report.subject?.version
  for (const driver of DRIVERS) if (!names(driver)) problems.push(`the SBOM names no ${driver}, a driver that talks to a customer's database`)
  for (const { package: name } of report.results?.buildIdentity ?? []) {
    if (!names(name, version)) problems.push(`the SBOM names no ${name} ${String(version)}, which this release publishes`)
  }
  for (const name of new Set(upstream.filter((entry) => entry.shipped === true).map((entry) => entry.name))) {
    if (!names(name)) problems.push(`the SBOM names no ${name}, which a published package depends on`)
  }
  const graph = dependencyGraph(sbom)
  const givenTo = (from, name) => (graph.get(`${from.name}@${String(from.version)}`) ?? []).filter((to) => to.name === name)
  for (const entry of runtime.filter((each) => !typesOnly(each.name))) {
    // A nested dependency is given by the one that declares it, at whichever version the published package is given that one.
    const declarers = entry.under === undefined ? [{ name: entry.package, version }] : givenTo({ name: entry.package, version }, entry.under)
    const declarer = declarers[0] ?? { name: entry.under, version: undefined }
    const given = declarers.flatMap((from) => givenTo(from, entry.name))
    if (given.length === 0) problems.push(`the SBOM records no dependency of ${declarer.name} on ${entry.name}`)
    // The version the suites ran, or the one the install gate's clean install resolved in this run, which the release body names as run by no suite.
    const fresh = entry.fresh === null || entry.fresh === undefined ? null : entry.fresh
    for (const to of given) {
      if (to.version !== entry.loaded && to.version !== fresh) problems.push(`the SBOM gives ${declarer.name} ${entry.name} ${to.version}, where its suites loaded ${entry.loaded}${fresh === null ? '' : ` and a clean install resolved ${fresh}`}`)
      else if (!names(to.name, to.version)) problems.push(`the SBOM names no ${to.name} ${to.version}, which ${declarer.name} depends on`)
    }
  }
  const loaded = new Map()
  for (const entry of upstream) loaded.set(entry.name, new Set([...(loaded.get(entry.name) ?? []), entry.version, ...(entry.fresh === null || entry.fresh === undefined ? [] : [entry.fresh])]))
  for (const component of components) {
    const versions = loaded.get(component.name)
    if (versions !== undefined && !versions.has(component.version)) problems.push(`the SBOM names ${component.name} ${component.version}, where the suites loaded ${[...versions].join(', ')}`)
  }
  return [...new Set(problems)]
}

/**
 * Every package an install holds, from npm's lockfile of it (its `packages`
 * map, lockfileVersion 2 and 3): `[{ name, version }]`, each as npm
 * installed it, nested copies included, the project itself, a link, a dev
 * dependency and a package of types alone left out.
 */
export function lockedPackages(lockfile) {
  return Object.entries(lockfile?.packages ?? {})
    .filter(([path, entry]) => path !== '' && entry?.link !== true && entry?.dev !== true)
    .map(([path, entry]) => ({ name: entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length), version: entry.version }))
    .filter((entry) => !typesOnly(entry.name))
}

/**
 * The SBOM against the install it describes (0092), `lockfile` being npm's
 * lockfile of the project `check` installed the tarballs into: every
 * component an npm package that install holds, at that version, and every
 * package it holds a component. The report says what the SBOM must name;
 * this says it names nothing else -- no test tool, no package of another
 * tree -- and leaves nothing out (formancy.ai-health's check).
 */
export function sbomInstallProblems(sbom, lockfile) {
  const installed = lockedPackages(lockfile)
  if (installed.length === 0) return ['the install the SBOM describes holds no package, so nothing it names can be held to it']
  const key = ({ name, version }) => `${name} ${String(version)}`
  const held = new Set(installed.map(key))
  const problems = []
  const named = new Set()
  for (const component of sbom?.components ?? []) {
    const npm = npmPurl(component.purl)
    if (npm === undefined) {
      problems.push(`the SBOM names ${String(component.name ?? component['bom-ref'] ?? 'a component')}, a component with no npm package URL, in an inventory of an npm install`)
      continue
    }
    named.add(key(npm))
    if (!held.has(key(npm))) problems.push(`the SBOM names ${key(npm)}, which the install it describes does not hold`)
  }
  for (const entry of held) if (!named.has(entry)) problems.push(`the SBOM leaves out ${entry}, which the install it describes holds`)
  return problems
}

/** The sha256 of each of `files` (`[{ path, bytes }]`) by its path: what `check` pins, as the publish job reads it back. */
export function pinned(files) {
  return Object.fromEntries(files.map(({ path, bytes }) => [path, sha256(bytes)]))
}

/**
 * What differs between the files `checked` pinned (`{ path: sha256 }`, or
 * the JSON of it, as a job output carries it) and the `files` downloaded:
 * each a sentence. A pin that is missing or empty refuses everything.
 */
function pinProblems(checked, files) {
  const pins = typeof checked === 'string' ? readPins(checked) : checked
  if (pins === null || pins === undefined || typeof pins !== 'object' || Object.keys(pins).length === 0) return ['the check job pinned no file, so nothing downloaded here can be shown to be what it checked']
  const problems = []
  const here = pinned(files)
  for (const [path, hash] of Object.entries(here)) {
    if (pins[path] === undefined) problems.push(`${path} was downloaded, and the check job never checked it`)
    else if (pins[path] !== hash) problems.push(`${path} is not the file the check job checked: sha256 ${hash}, checked ${pins[path]}`)
  }
  for (const path of Object.keys(pins)) if (here[path] === undefined) problems.push(`${path} was checked by the check job, and was not downloaded`)
  return problems
}

/**
 * Every reason the publish job refuses what it downloaded: a file `check`
 * did not pin or pinned otherwise, and a report that is not this run's,
 * green and whole. `files` are `[{ path, bytes }]`; the rest as publishProblems.
 */
export function downloadedProblems({ checked, files, report, release, version, commit, runId }) {
  return [...pinProblems(checked, files), ...reportProblems(report, { release, version, commit, runId })]
}

/**
 * What `check` refuses before cdxgen runs, as sentences: the report, the
 * tarballs and the body. Pure: `report` is the report's JSON, `tarballs` each
 * tarball as describeTarball() gives it, `notes` the release body or null,
 * and `release`, `version`, `commit` and `runId` this run's.
 */
export function contentProblems({ report, tarballs, notes, release, version, commit, runId }) {
  return [
    ...reportProblems(report, { release, version, commit, runId }),
    ...tarballProblems(report, tarballs, version),
    ...(notes === null ? ['the report job wrote no release body'] : notes.length > BODY_LIMIT ? [`the release body is ${String(notes.length)} characters, over the ${String(BODY_LIMIT)} GitHub accepts`] : []),
  ]
}

/** Every reason not to publish, as sentences; none means the release may go on. contentProblems() and sbomProblems() of the CycloneDX JSON `sbom`. */
export function publishProblems({ sbom, ...inputs }) {
  return [...contentProblems(inputs), ...sbomProblems(inputs.report, sbom)]
}

/** Every file directly under `dir`, as `{ path, bytes }` with the path as the workflow names it, '/'-separated. */
function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ path: relative(process.cwd(), join(dir, name)).replaceAll('\\', '/'), bytes: readFileSync(join(dir, name)) }))
}

/** The tarballs under `dir`, as describeTarball() gives them. */
const tarballsIn = (dir) =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.tgz'))
    .sort()
    .map((file) => describeTarball(file, readFileSync(join(dir, file))))

/** A pin as a job output carries it, `{ path: sha256 }` in JSON; null when it is missing, empty or not that. */
export function readPins(value) {
  try {
    const parsed = JSON.parse(value ?? '')
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0 ? parsed : null
  } catch {
    return null
  }
}

/** Writes `name=value` to the step's outputs on GitHub, and prints it anywhere. */
function output(name, value) {
  if (process.env.GITHUB_OUTPUT !== undefined) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
  console.log(`${name}=${value}`)
}

// `node scripts/release-report/verify-publish.mjs --stage content|sbom|downloads ...`
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/release-report/verify-publish.mjs')) {
  const argv = process.argv.slice(2)
  const option = (name) => {
    const value = argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined
    if (value === undefined || value === '') throw new Error(`verify-publish.mjs needs ${name}`)
    return value
  }
  const stage = option('--stage')
  const run = () => {
    for (const name of ['GITHUB_SHA', 'GITHUB_RUN_ID']) if (!process.env[name]) throw new Error(`verify-publish.mjs checks the report against this run, and ${name} is not set`)
    return { release: option('--release'), version: option('--version'), commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID }
  }
  const reportFile = resolve(option('--report'))
  const report = JSON.parse(readFileSync(reportFile, 'utf8'))
  let problems
  if (stage === 'content') {
    const notes = resolve(option('--notes'))
    const dir = resolve(option('--tarballs'))
    problems = contentProblems({ ...run(), report, tarballs: tarballsIn(dir), notes: existsSync(notes) ? readFileSync(notes, 'utf8') : null })
    if (problems.length === 0) output('checked', JSON.stringify(pinned([...filesIn(dirname(reportFile)), ...filesIn(dir)])))
  } else if (stage === 'sbom') {
    const file = resolve(option('--sbom'))
    const sbom = JSON.parse(readFileSync(file, 'utf8'))
    problems = [...sbomProblems(report, sbom), ...sbomInstallProblems(sbom, JSON.parse(readFileSync(resolve(option('--installed')), 'utf8')))]
    if (problems.length === 0) output('checked', JSON.stringify(pinned([{ path: relative(process.cwd(), file).replaceAll('\\', '/'), bytes: readFileSync(file) }])))
  } else if (stage === 'downloads') {
    const sbom = resolve(option('--sbom'))
    // Both of check's pins, or none: a stage whose output is missing pinned nothing.
    const [content, bom] = [process.env.CHECKED, process.env.CHECKED_SBOM].map(readPins)
    const files = [...filesIn(dirname(reportFile)), ...filesIn(resolve(option('--tarballs'))), { path: relative(process.cwd(), sbom).replaceAll('\\', '/'), bytes: readFileSync(sbom) }]
    problems = downloadedProblems({ ...run(), checked: content === null || bom === null ? null : { ...content, ...bom }, files, report })
  } else throw new Error(`verify-publish.mjs --stage is content, sbom or downloads, not ${stage}`)
  for (const problem of problems) console.error(`::error::${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log(stage === 'downloads' ? 'verify-publish.mjs --stage downloads: every file is what check pinned, and the report is this run’s' : `verify-publish.mjs --stage ${stage}: what this run gated, checked and pinned`)
}
