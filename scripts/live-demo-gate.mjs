// `pnpm test:live-demo`: the live demo at formancy.ai/data/demo/ (0070), end
// to end on one machine, without Cloudflare's network.
//
//  1. The host page's demo build (`build:demo`) and the image
//     (deploy/demo/Dockerfile, linux/amd64, from the repository root as
//     Wrangler builds it), each timed, the image's size read.
//  2. The demo's routes on a loopback origin (live-demo-gate/origin.mjs):
//     the page's files with the `_headers` the deploy writes, read back,
//     and everything else through the Worker -- the Worker's own module,
//     dist/worker/cloudflare.mjs, its fetch and its DemoServer, over a
//     stand-in for Cloudflare's runtime whose containers are `docker run`s
//     of the image at wrangler.json's instance type's share
//     (live-demo-gate/cloudflare.mjs says what the stand-in is, and why
//     `wrangler dev` is not it).
//  3. A visitor's journey over HTTP (live-demo-gate/journey.mjs): the
//     session, a sign-in from another site refused, the cold start, the
//     cookie, each persona's menu, nine pages of each tenant's orders, a
//     search, the customer typeahead keeping to a tenant, the data's
//     invariants through the product, a create, the same create sent again
//     answered once, a line, another tenant's 404, the auditor's 403, a
//     change, a delete with its cascade, a path that is not plain, the
//     headers on every forwarded answer, every route 0037's runtime door
//     does not forward answered by the Worker's own 404, the
//     administrator's routes sent straight to the container answered by
//     the server's own 404, and the Worker's 405.
//  4. The container's peak memory, and whether it was killed for memory.
//  5. A second visitor: their own container, which never sees the first
//     visitor's changes.
//  6. Neither the identity key nor the database password in what the
//     container wrote.
//  7. The reset: the first visitor's container stopped, as its idle
//     timeout stops it; their next request is the Worker's not-running
//     answer, the Durable Object's alarm forgets the key, and two sign-ins
//     at once start one new container, with a new key: the old token
//     refused, the created order gone, the generated data there.
//  8. The page in Chromium (apps/host/scripts/browser/demo.mjs), under the
//     demo's path with its headers, against the same Worker and image.
//
// It prints the measurements as Markdown, and on GitHub appends them to the
// job summary. It removes every container it started and the image it
// built, however it ends; `--keep-image` keeps the image.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoPass } from '../apps/host/scripts/browser/demo.mjs'
import { parseHeadersFile } from './demo-headers.mjs'
import { DockerContainer, docker, durableObjects, loadWorker } from './live-demo-gate/cloudflare.mjs'
import { leaks, quotaOf } from './live-demo-gate/docker.mjs'
import { apiJourney, visitor } from './live-demo-gate/journey.mjs'
import { serveOrigin } from './live-demo-gate/origin.mjs'
import { liveHeadersFile } from './live-demo-headers.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const pure = await import('../apps/live-demo/dist/worker/pure.mjs')
const { IDENTITY_SECRET_VARIABLE, NOT_RUNNING, PER_TENANT, PREFIX, SERVER_PORT } = pure

/**
 * How long a build may take before the gate ends it: about three times
 * (2.9) the slowest the image's build was measured, 313,851 ms, by this
 * gate with the install's layer not cached, on the Windows workstation with
 * Docker Desktop on 2026-10-17; built with --no-cache and the base images
 * already pulled it took 53.1 and 56.4 s on 2026-10-16
 * (deploy/demo/Dockerfile's header). Not measured on CI, where it stays
 * under the live-demo job's 20 minutes so that a slow build ends with this
 * gate's report rather than the job's.
 */
const BUILD_LIMIT = 15 * 60_000

/** A command of the gate's own, its output shown as it comes; resolves when it ends, rejects when it fails or outlives `limit`. */
function command(file, args, { limit = BUILD_LIMIT, cwd = repo } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' && file === 'pnpm', windowsHide: true })
    const timer = setTimeout(() => child.kill(), limit)
    child.on('close', (status) => {
      clearTimeout(timer)
      if (status === 0) resolve()
      else reject(new Error(`${file} ${args.join(' ')} exited ${String(status)}`))
    })
  })
}

/** The checks, in order: a name and the problem, null when it held. */
const checks = []
const check = (name, problem) => {
  checks.push({ name, problem })
  console.log(`${problem === null ? 'ok  ' : 'FAIL'} ${name}${problem === null ? '' : `: ${problem}`}`)
}
const timings = []
async function timed(name, work) {
  const began = Date.now()
  const result = await work()
  timings.push({ name, ms: Date.now() - began })
  return result
}

const bytes = (value) => value.toLocaleString('en-US')

/** The measurements as Markdown: what 0070 cites, with when and on what. */
function report({ when, on, image, size, starts, memory, outcome, total }) {
  const lines = [
    '### The live demo, end to end on one machine',
    '',
    `${when}, ${on}. ${outcome}`,
    '',
    `Image \`${image}\`: ${bytes(size)} bytes (\`docker image inspect\` .Size). Each container at the share of wrangler.json's instance type: \`docker run --cpus ${starts.quota.cpus} --memory ${starts.quota.memory} --memory-swap ${starts.quota.swap}\`, a quota emulating it, not Cloudflare's scheduler.`,
    '',
    '| Step | ms |',
    '| --- | ---: |',
    ...timings.map((timing) => `| ${timing.name} | ${bytes(timing.ms)} |`),
    `| The whole gate, from its start to this table | ${bytes(total)} |`,
    '',
    '| Container start | `docker run` to /health 200, ms |',
    '| --- | ---: |',
    ...starts.list.map((start) => `| ${start.label} | ${start.healthy === undefined ? 'never' : bytes(start.healthy)} |`),
    '',
    `Peak memory of the first visitor's container after its journey: ${memory === undefined ? 'not read' : `${bytes(memory.bytes)} bytes (${memory.from})${memory.killed ? ', killed for memory' : ''}`}.`,
  ]
  return `${lines.join('\n')}\n`
}

async function main() {
  const began = Date.now()
  const when = new Date(began).toISOString()
  const keepImage = process.argv.includes('--keep-image')
  const run = randomBytes(4).toString('hex')
  const image = `formancy/data-demo:gate-${run}`
  const config = JSON.parse(readFileSync(join(repo, 'apps', 'live-demo', 'wrangler.json'), 'utf8'))
  const [declared] = config.containers
  const quota = quotaOf(declared.instance_type)
  const on = `${(await docker(['version', '--format', 'Docker {{.Server.Version}} on {{.Server.Os}}/{{.Server.Arch}}, kernel {{.Server.KernelVersion}}'])).trim()}, Node ${process.version} on ${process.platform}`
  console.log(`The live demo's gate: run ${run}, ${on}`)

  let server
  let stand
  let built = false
  let size = 0
  let memory
  let failure
  const startsOf = () =>
    [...(stand?.objects.entries() ?? [])].flatMap(([name, object], at) =>
      object.state.container.starts.map((start, n) => ({ label: `visitor ${String(at + 1)}${n === 0 ? '' : `, start ${String(n + 1)}`} (${name.slice(0, 6)}…)`, healthy: start.healthyAt === undefined ? undefined : start.healthyAt - start.startedAt })),
    )
  try {
    await timed('Host page, demo build (`build:demo`)', () => command('pnpm', ['--filter', '@formancy/data-host', 'build:demo']))
    await timed('Image build (`docker build --platform linux/amd64`)', () => command('docker', ['build', '--platform', 'linux/amd64', '-f', 'deploy/demo/Dockerfile', '-t', image, '.']))
    built = true
    size = Number((await docker(['image', 'inspect', '--format', '{{.Size}}', image])).trim())

    const worker = await loadWorker(join(repo, 'apps', 'live-demo', 'dist', 'worker', 'cloudflare.mjs'))
    let made = 0
    stand = durableObjects(worker.DemoServer, () => new DockerContainer({ image, name: `formancy-data-demo-gate-${run}-${String((made += 1))}`, quota, port: SERVER_PORT }))
    const rules = parseHeadersFile(liveHeadersFile(`${PREFIX}/`))
    ;({ server, origin: stand.origin } = await serveOrigin({ directory: join(repo, 'apps', 'host', 'dist-demo'), prefix: PREFIX, assets: config.assets, rules, worker: (request) => worker.default.fetch(request, stand.env) }))
    console.log(`The demo on ${stand.origin}${PREFIX}/`)

    const journey = await apiJourney({ origin: stand.origin, stand, check, timed })
    const first = journey.objectOf(journey.a)
    const container = first.state.container

    memory = await container.memory()
    check("the first visitor's container was not killed for memory", memory.killed ? 'it was' : null)

    // A second visitor: an instance, a container and a database of their own.
    const b = visitor(stand.origin)
    const signed = await timed('Sign-in, a second visitor: their own container', () => b.signIn('clara'))
    const theirs = journey.objectOf(b)
    check('a second visitor gets a cookie, an instance and a container of their own', signed.status === 200 && b.cookie !== journey.a.cookie && theirs !== undefined && theirs !== first && theirs.state.container.starts.length === 1 ? null : `answered ${String(signed.status)}`)
    const created = await b.api('POST', '/v1/forms/order/records/read', { token: signed.json?.token, body: { record: journey.record } })
    const touched = await b.api('POST', '/v1/forms/order/records/read', { token: signed.json?.token, body: { record: journey.touched.record } })
    check("the second visitor sees neither the first one's new order nor their change", created.status === 404 && touched.status === 200 && (touched.json.answers.notes ?? null) === journey.touched.before ? null : `the new order answered ${String(created.status)}; the changed one says ${JSON.stringify(touched.json?.answers?.notes)}`)

    // What the container wrote holds neither of its secrets.
    const key = first.state.stored().get('key')
    const password = await container.serverVariable('FORMANCY_DEMO_DB_PASSWORD')
    check('neither the identity key nor the database password is in what the container wrote', leaks([{ where: "the first visitor's container's output", text: container.log }], { 'the identity key': key, 'the database password': password }).join('; ') || null)
    check('the key the container verifies with is the one the Durable Object stored', (await container.serverVariable(IDENTITY_SECRET_VARIABLE)) === key ? null : 'they differ')

    // The reset, as the idle timeout makes it.
    await container.destroy()
    const stopped = await journey.a.api('GET', '/v1/forms', { token: journey.tokens.clara })
    check("once the container has stopped, the visitor's request is the Worker's not-running answer", stopped.status === 503 && stopped.json?.message === NOT_RUNNING ? null : `answered ${String(stopped.status)} ${stopped.text}`)
    await first.server.alarm()
    check("the Durable Object's alarm forgets the key once no container runs", first.state.stored().size === 0 ? null : `it still stores ${[...first.state.stored().keys()].join(', ')}`)
    const again = await timed('Sign-in after the reset: two at once, one start', () => Promise.all([journey.a.signIn('clara'), journey.a.signIn('clara')]))
    check('two sign-ins at once start one container, and both are answered', again.every((answer) => answer.status === 200) && container.starts.length === 2 ? null : `answered ${again.map((answer) => answer.status).join(', ')} with ${String(container.starts.length)} starts`)
    const fresh = again[0].json?.token
    const both = await Promise.all(again.map((answer) => journey.a.api('GET', '/v1/forms', { token: answer.json?.token })))
    check('both tokens of the new start are accepted', both.every((answer) => answer.status === 200) ? null : `answered ${both.map((answer) => answer.status).join(', ')}`)
    const old = await journey.a.api('GET', '/v1/forms', { token: journey.tokens.clara })
    check("the token of before the reset is refused by the new start's key", old.status === 401 ? null : `answered ${String(old.status)}`)
    const after = await journey.a.api('POST', '/v1/forms/order/records/read', { token: fresh, body: { record: journey.record } })
    const restored = await journey.a.api('POST', '/v1/forms/order/records/read', { token: fresh, body: { record: journey.touched.record } })
    const listed = await journey.a.api('POST', '/v1/forms/order/records/list', { token: fresh, body: { limit: 1, offset: PER_TENANT.orders - 1 } })
    check('after the reset the created order is gone and the generated data is as generated', after.status === 404 && (restored.json?.answers?.notes ?? null) === journey.touched.before && listed.json?.rows?.length === 1 && listed.json?.hasMore === false ? null : `the created order answered ${String(after.status)}, the changed one says ${JSON.stringify(restored.json?.answers?.notes)}, the last page ${JSON.stringify(listed.json?.rows?.length)}`)

    // The page, in Chromium, as a third visitor: their own container.
    await demoPass({ origin: stand.origin, prefix: PREFIX, check, timed })
  } catch (error) {
    failure = error
  }

  if (failure !== undefined || checks.some((entry) => entry.problem !== null)) {
    for (const [name, object] of stand?.objects ?? []) console.error(`\n--- the output of ${name.slice(0, 6)}…'s container, its last 40 lines\n${object.state.container.log.split('\n').slice(-40).join('\n')}`)
  }
  for (const object of stand?.objects.values() ?? []) await object.state.container.destroy()
  const left = (await docker(['ps', '--all', '--quiet', '--filter', `name=formancy-data-demo-gate-${run}`]).catch(() => '')).trim()
  if (left !== '') await docker(['rm', '--force', '--volumes', ...left.split(/\s+/)]).catch(() => {})
  server?.close()
  if (built && !keepImage) await docker(['image', 'rm', image]).catch((error) => console.error(`Could not remove ${image}: ${error.message}`))

  const failed = checks.filter((entry) => entry.problem !== null)
  const outcome = failure === undefined && failed.length === 0 ? `Passed: ${String(checks.length)} checks.` : 'Failed.'
  const table = report({ when, on, image, size, starts: { quota, list: startsOf() }, memory, outcome, total: Date.now() - began })
  console.log(`\n${table}`)
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`)
  if (failure !== undefined) console.error(`\nThe live demo's gate could not finish: ${failure.stack ?? failure.message}`)
  if (failed.length > 0) console.error(`\n${String(failed.length)} of ${String(checks.length)} checks failed:\n- ${failed.map((entry) => `${entry.name}: ${entry.problem}`).join('\n- ')}`)
  if (failure !== undefined || failed.length > 0) process.exitCode = 1
}

await main()
