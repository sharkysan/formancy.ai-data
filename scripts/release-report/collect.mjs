// What one job of a run found, in one file the release report reads (0035).
//
//   node scripts/release-report/collect.mjs --job test --package @formancy/data-host
//   node scripts/release-report/collect.mjs --job getting-started --variant 2.20.3
//   node scripts/release-report/collect.mjs --job container --image formancy/data-server:ci
//   node scripts/release-report/collect.mjs --local --since 2026-10-09T20:00:00Z
//
// It writes `release-results/<key>.json` and, on GitHub, `key=<key>` to the
// step's outputs, so the artefact's name and the file's key have one source.
// The key is the job, `test-<id>` for a package's suite with the id
// codecov-config.mjs gives it, and the job with `--variant` appended for a
// job a matrix runs more than once.
//
// Node's built-ins and coveredPackages() only: it runs in the container and
// getting-started jobs, which install nothing.
//
// What it reads, each where its writer puts it: a suite's
// `test-results/vitest.json` and `coverage/coverage-summary.json`, turbo's
// `.turbo/runs/*.json` for the task's own start and end, every
// `test-results/servers/*.json` record of a server a suite or a gate started
// (data-fixtures, or the getting-started journey), a browser gate's
// `test-results/browser.json`, the install gate's `test-results/install.json`,
// and every published package's `dist/`. What it expected and did not find
// it lists under `missing`, and the report fails on that.
//
// `--local` reads every package and app of one machine at once. It refuses
// a results file that started before `--since`, which has no default: a
// file left by an earlier run read as this one's is the failure local mode
// has to rule out, and only the person running it knows from when.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { coveredPackages } from '../codecov-config.mjs'
import { distHash, filesUnder } from './dist-hash.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The scripts whose server records belong to a package's suite, and to a browser gate; `direct` is a run with no package script. */
const SUITE_SCRIPTS = new Set(['test-coverage', 'test', 'direct'])
const GATE_SCRIPTS = new Set(['test-browser', 'direct'])

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const slash = (path) => path.replaceAll('\\', '/')
const time = (value) => (typeof value === 'number' ? value : Date.parse(value))

/** A matrix value safe in an artefact's name. */
const safe = (value) => String(value).replaceAll(/[^A-Za-z0-9.]+/g, '-')

/** The key of a job's results: the artefact is `release-results-<key>`. */
export function keyFor({ job, pkg, variant }, covered) {
  let key = job
  if (job === 'test') {
    const entry = covered.find((candidate) => candidate.name === pkg)
    if (entry === undefined) throw new Error(`--package ${String(pkg)} is no workspace package with a test:coverage script`)
    key = `test-${entry.id}`
  }
  return variant === undefined ? key : `${key}-${safe(variant)}`
}

/** coveredPackages() with each package's npm name: what keyFor() keys a package's results by. */
export function namedPackages(root = repo) {
  return coveredPackages(root).map((entry) => ({ ...entry, name: readJson(join(root, entry.path, 'package.json')).name }))
}

/** Every workspace app with a `test:browser` script, and every published package: `{ path, name }`. */
function workspaceWith(root, keep) {
  const found = []
  for (const group of ['packages', 'apps']) {
    if (!existsSync(join(root, group))) continue
    for (const name of readdirSync(join(root, group)).sort()) {
      const file = join(root, group, name, 'package.json')
      if (!existsSync(file)) continue
      const manifest = readJson(file)
      if (keep(`${group}/${name}`, manifest)) found.push({ path: `${group}/${name}`, name: manifest.name })
    }
  }
  return found
}
const browserApps = (root) => workspaceWith(root, (path, manifest) => path.startsWith('apps/') && manifest.scripts?.['test:browser'] !== undefined)
const publishedPackages = (root) => workspaceWith(root, (path, manifest) => path.startsWith('packages/') && manifest.private !== true)

/** Each connection the getting-started journey runs on, with its engine: scripts/getting-started/journey.json's forms, through deploy/connections.json. */
function journeyConnections(root) {
  const connections = readJson(join(root, 'deploy', 'connections.json'))
  return readJson(join(root, 'scripts', 'getting-started', 'journey.json')).forms.map(({ connection }) => {
    const entry = connections.find((candidate) => candidate.id === connection)
    if (entry === undefined) throw new Error(`deploy/connections.json has no connection ${connection}, which scripts/getting-started/journey.json names`)
    return { connection, kind: entry.kind }
  })
}

/** A server record checked to be what data-fixtures and the getting-started journey write; throws, naming its file, when it is not. */
export function checkedRecord(record, file) {
  const problems = []
  const string = (key) => typeof record?.[key] === 'string' && record[key] !== ''
  const nullable = (key) => record?.[key] === null || typeof record?.[key] === 'string'
  for (const key of ['engine', 'image', 'version', 'script', 'at']) if (!string(key)) problems.push(`${key} is not a string`)
  for (const key of ['updateLevel', 'edition', 'description', 'caller']) if (!nullable(key)) problems.push(`${key} is neither a string nor null`)
  if (string('at') && Number.isNaN(Date.parse(record.at))) problems.push('at is not an instant')
  if (problems.length > 0) throw new Error(`${file} is not a server record: ${problems.join(', ')}`)
  return record
}

/** Every server record under `<dir>/test-results/servers`, checked, with the file it came from. */
function serverRecords(root, dir) {
  const folder = join(root, dir, 'test-results', 'servers')
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = slash(relative(root, join(folder, name)))
      let record
      try {
        record = readJson(join(folder, name))
      } catch (error) {
        throw new Error(`${file} is not a server record: ${error.message}`)
      }
      return { ...checkedRecord(record, file), file }
    })
}

/** The records of `scripts` made within [from, to], each with the package it was found in and its caller repository-relative. */
function within(records, scripts, from, to, pkg, root) {
  return records
    .filter((record) => scripts.has(record.script) && time(record.at) >= from && time(record.at) <= to)
    .map(({ file: _, ...record }) => ({
      ...record,
      package: pkg,
      caller: record.caller === null ? null : isAbsolute(record.caller) ? slash(relative(root, record.caller)) : slash(record.caller),
    }))
}

/** A suite's vitest JSON, normalised: totals, and each file with each test's status and the meta covers() declared. */
export function normaliseSuite(json, root) {
  return {
    success: json.success,
    numTotalTests: json.numTotalTests,
    numPassedTests: json.numPassedTests,
    numFailedTests: json.numFailedTests,
    numPendingTests: json.numPendingTests,
    numTodoTests: json.numTodoTests,
    numFailedTestSuites: json.numFailedTestSuites,
    startTime: json.startTime,
    files: json.testResults.map((file) => ({
      file: slash(relative(root, file.name)),
      status: file.status,
      startTime: file.startTime,
      endTime: file.endTime,
      tests: file.assertionResults.map((test) => ({ name: test.fullName, status: test.status, durationMs: test.duration ?? null, meta: test.meta ?? {} })),
    })),
  }
}

/** The newest turbo run summary's entry for `taskId`: its own start and end, and whether turbo replayed it. */
function turboTask(root, taskId) {
  const folder = join(root, '.turbo', 'runs')
  if (!existsSync(folder)) return undefined
  const runs = readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(join(folder, name)))
    .sort((a, b) => (a.execution?.startTime ?? 0) - (b.execution?.startTime ?? 0))
  for (const run of runs.reverse()) {
    const task = run.tasks?.find((candidate) => candidate.taskId === taskId)
    if (task !== undefined) return { startTime: task.execution?.startTime ?? null, endTime: task.execution?.endTime ?? null, cache: task.cache?.status ?? null }
  }
  return undefined
}

/** The facts a result file opens with: which machine, which commit, which run. */
function runner(env, docker) {
  let server = null
  try {
    server = docker(['version', '--format', '{{.Server.Version}}']).trim()
  } catch {
    // No Docker here: the container and getting-started jobs have it; a verify job need not.
  }
  return { node: process.version, platform: process.platform, arch: process.arch, image: env.ImageOS ?? null, imageVersion: env.ImageVersion ?? null, docker: server }
}

/** Digest and image id of each distinct image the records name, from the machine that ran them. */
function withDigests(records, docker, missing) {
  const seen = new Map()
  return records.map((record) => {
    if (!seen.has(record.image)) {
      try {
        const [digests, id] = docker(['image', 'inspect', '--format', '{{json .RepoDigests}} {{.Id}}', record.image]).trim().split(' ')
        seen.set(record.image, { digest: JSON.parse(digests)[0] ?? null, imageId: id ?? null })
      } catch {
        missing.push(`the digest of ${record.image}, which docker image inspect could not give`)
        seen.set(record.image, { digest: null, imageId: null })
      }
    }
    return { ...record, ...seen.get(record.image) }
  })
}

/** Everything one job (or, locally, one machine) found. Pure over the files under `root` and the `docker` and `git` it is given. */
export function collect({ root = repo, job, pkg, variant, image, local = false, since, env = process.env, docker = defaultDocker, git = defaultGit, now = () => new Date() }) {
  const packages = namedPackages(root)
  const key = local ? 'local' : keyFor({ job, pkg, variant }, packages)
  const missing = []
  const after = local ? time(since) : Number.NEGATIVE_INFINITY
  if (local && Number.isNaN(after)) throw new Error('--local needs --since <ISO instant>: results older than it are refused as stale, and nothing else can say from when')
  const collectedAt = now()
  const fresh = (path, started, verb = 'started') => {
    if (time(started) >= after) return true
    missing.push(`stale: ${path} ${verb} ${new Date(time(started)).toISOString()}, before --since`)
    return false
  }

  const suites = []
  const servers = []
  const suiteOf = (path, name) => {
    const file = join(root, path, 'test-results', 'vitest.json')
    if (!existsSync(file)) return void missing.push(`${slash(join(path, 'test-results', 'vitest.json'))}`)
    const json = readJson(file)
    if (!fresh(slash(join(path, 'test-results', 'vitest.json')), json.startTime)) return
    // The suite's wall time and coverage come from two more files, each held
    // to --since as vitest's is: a fresh vitest.json beside yesterday's
    // summary would print yesterday's numbers as this run's.
    const summary = join(path, 'coverage', 'coverage-summary.json')
    let task = name === null ? undefined : turboTask(root, `${name}#test:coverage`)
    if (task === undefined && name !== null && !local) missing.push(`turbo's run summary for ${name}#test:coverage (run it with --summarize)`)
    if (task?.startTime != null && !fresh(`turbo's run summary for ${name}#test:coverage`, task.startTime)) task = undefined
    if (task?.cache === 'HIT') missing.push(`a fresh run of ${name}#test:coverage: turbo replayed it from its cache`)
    let coverage = null
    if (existsSync(join(root, summary)) && fresh(slash(summary), statSync(join(root, summary)).mtimeMs, 'written')) coverage = readJson(join(root, summary)).total
    suites.push({ package: name, path, ...normaliseSuite(json, root), task: task ?? null, coverage })
    servers.push(...within(serverRecords(root, path), SUITE_SCRIPTS, json.startTime, collectedAt.getTime(), name, root))
  }

  const browserGates = []
  const gateOf = (path) => {
    const file = join(root, path, 'test-results', 'browser.json')
    if (!existsSync(file)) return void missing.push(slash(join(path, 'test-results', 'browser.json')))
    const result = readJson(file)
    if (!fresh(slash(join(path, 'test-results', 'browser.json')), result.startedAt)) return
    browserGates.push(result)
    servers.push(...within(serverRecords(root, path), GATE_SCRIPTS, time(result.startedAt), time(result.finishedAt), result.gate, root))
  }

  let install = null
  const installOf = () => {
    const file = join(root, 'test-results', 'install.json')
    if (!existsSync(file)) return void missing.push('test-results/install.json')
    const result = readJson(file)
    if (fresh('test-results/install.json', result.startedAt)) install = result
  }

  let container = null
  if (local) {
    for (const entry of packages) suiteOf(entry.path, entry.name)
    suiteOf('.', null)
    for (const app of browserApps(root)) gateOf(app.path)
    installOf()
  } else if (job === 'test') {
    suiteOf(packages.find((entry) => entry.name === pkg).path, pkg)
  } else if (job === 'verify') {
    suiteOf('.', null)
  } else if (job === 'browser') {
    for (const app of browserApps(root)) gateOf(app.path)
  } else if (job === 'install') {
    installOf()
  } else if (job === 'container') {
    if (image === undefined) throw new Error('--job container needs --image, the image the gate built')
    try {
      container = {
        image,
        size: Number(docker(['image', 'inspect', '--format', '{{.Size}}', image]).trim()),
        node: docker(['run', '--rm', '--entrypoint', 'node', image, '--version']).trim(),
        user: docker(['run', '--rm', '--entrypoint', 'id', image, '-un']).trim(),
      }
    } catch (error) {
      missing.push(`the container gate's image ${image}: ${error.message.split('\n')[0]}`)
    }
  }
  // The getting-started journey's composed servers (0032), recorded at the
  // root. In its own job, one per connection the journey runs on, or the
  // report fails: a journey that recorded none would leave it silent on
  // what the guide ran, with the job green.
  if (local || job === 'getting-started') servers.push(...within(serverRecords(root, '.'), new Set(['getting-started']), after, collectedAt.getTime(), null, root))
  if (job === 'getting-started') {
    for (const { connection, kind } of journeyConnections(root)) {
      if (!servers.some((server) => server.script === 'getting-started' && server.engine === kind)) {
        missing.push(`a record of the composed ${kind} database behind the journey’s connection ${connection}, which scripts/getting-started.mjs writes after the journey`)
      }
    }
  }

  const dist = publishedPackages(root).flatMap(({ path, name }) => {
    const files = filesUnder(join(root, path, 'dist'))
    return files === undefined || files.size === 0 ? [] : [{ package: name, distHash: distHash(files) }]
  })

  return {
    schema: 1,
    job: local ? 'local' : job,
    key,
    ...(pkg === undefined ? {} : { package: pkg }),
    ...(variant === undefined ? {} : { variant }),
    runner: runner(env, docker),
    commit: env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']).trim(),
    run: { id: env.GITHUB_RUN_ID ?? null, attempt: env.GITHUB_RUN_ATTEMPT ?? null },
    collectedAt: collectedAt.toISOString(),
    // A local run tests the tree as it is, so whether it held uncommitted
    // changes is part of which code ran; a CI checkout is the commit.
    ...(local ? { since: new Date(after).toISOString(), dirty: git(['status', '--porcelain']).trim() !== '' } : {}),
    suites,
    servers: withDigests(servers, docker, missing),
    browserGates,
    install,
    container,
    dist,
    tarballs: install?.tarballs ?? [],
    missing,
  }
}

function defaultDocker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
function defaultGit(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

/** The value after `--name`, or undefined. */
const option = (argv, name) => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

// `node scripts/release-report/collect.mjs ...`
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/release-report/collect.mjs')) {
  const argv = process.argv.slice(2)
  const local = argv.includes('--local')
  const job = option(argv, '--job')
  if (!local && job === undefined) throw new Error('usage: collect.mjs --job <job> [--package <name>] [--variant <value>] [--image <image>], or --local --since <ISO instant>')
  const result = collect({ job, pkg: option(argv, '--package'), variant: option(argv, '--variant'), image: option(argv, '--image'), local, since: option(argv, '--since') })
  const out = resolve(repo, option(argv, '--out') ?? 'release-results')
  const written = join(out, `${result.key}.json`)
  mkdirSync(out, { recursive: true })
  writeFileSync(written, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  if (process.env.GITHUB_OUTPUT !== undefined) appendFileSync(process.env.GITHUB_OUTPUT, `key=${result.key}\n`)
  console.log(`${slash(relative(repo, written))}: ${String(result.suites.length)} suite(s), ${String(result.servers.length)} server(s), ${String(result.browserGates.length)} browser gate(s)${result.missing.length === 0 ? '' : `; missing: ${result.missing.join('; ')}`}`)
}
