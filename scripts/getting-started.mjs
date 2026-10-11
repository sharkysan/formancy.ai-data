// `pnpm test:getting-started`: runs docs/getting-started.md (0032).
//
// Release gate 9 asks for clean-install documentation that works with both
// databases, and a guide nothing runs is a claim nobody checked. So this runs
// the guide's own ```sh blocks, in order, exactly as written, from a checkout
// with nothing installed -- Node 22's built-ins and Docker are all it uses --
// and then checks what an operator would have:
//
//  1. compose's resolved configuration, before anything starts: loopback
//     only, no server port, no secret held as a value, nothing that restarts
//     on its own, and every file of the checkout a service that is not root
//     reads readable by it;
//  2. the commands, each through the platform's shell -- sh on CI, where it
//     runs. steps.mjs refuses any character sh, PowerShell and cmd read
//     differently, which is what makes a command that passes under sh mean
//     the same in the other two; no gate runs them there. The start step is
//     run again after the tokens are minted, with PostgreSQL logging every
//     statement, so the seeds are shown safe to run again and to say nothing
//     a log keeps;
//  3. the tokens, taken only from what the guide's commands printed and
//     classified by the identity the server derives from each: an
//     administrator, tenant 1's clerk and tenant 2's;
//  4. that the server and the minter can read the secrets their settings
//     name, and no other;
//  5. the pages, through the one origin: every script and stylesheet the
//     studio and the host page name is served with its type, and beside
//     each page its third-party notices, as text that says it is UTF-8
//     (0046);
//  6. the journey the guide walks, over HTTP, on PostgreSQL then SQL Server,
//     with journey.json's values -- the ones the guide's tables are generated
//     from (journey.mjs) -- and each database's version as the server's own
//     adapter reports it, written to test-results/servers/ for the release
//     report (0035);
//  7. the commands section 7 names in running text, against the running
//     stack, and on Linux the server answering at its container address, as
//     section 8 says;
//  8. that no secret and no token reached a log, the configuration or a
//     container's inspect;
//  9. the guide's `down`, then its start again, every container recreated:
//     every token still accepted, which is the secrets kept; both forms and
//     both orders still there, which is the store and the databases kept; and
//     the audit trail of before gone with the server's container, as section
//     8 says. Then the leak check again, and the guide's `down -v`, after
//     which the project has no volume left -- and, checked once the stack
//     has started, no container mounts a volume compose.yaml does not name,
//     which would carry no project label and outlive every `down`;
// 10. the image sizes, and how long each step took, printed as the
//     measurement table 0032 quotes.
//
// Isolated: its own compose project and free ports, passed in the
// environment so the guide's commands stay as written. It never touches
// another project, and it removes its own, volumes included, however it ends.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { call, classify, composedServer, journeyFor, MISSING, stillThere, writeServerRecord } from './getting-started/journey.mjs'
import {
  anonymousMountProblems,
  auditEvents,
  bindMountProblems,
  compose,
  configProblems,
  containerAddresses,
  directStatus,
  exposureProblems,
  haystacks,
  imageSizes,
  leaks,
  machine,
  namedSecretFiles,
  pageProblems,
  projectContainers,
  projectVolumes,
  readableSecretFiles,
  readHostFile,
  readSecrets,
  redact,
  servicesWithContainers,
} from './getting-started/stack.mjs'
import { extractSteps, GUIDE, inlineCommands, plan, readJourney } from './getting-started/steps.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The start step builds both images and pulls SQL Server's, about a gigabyte and a half; every other step is one short command. */
const START_LIMIT = 20 * 60_000
const STEP_LIMIT = 2 * 60_000
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/** A port nothing on loopback holds right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Ends a step's process and whatever its shell started. */
function stop(child) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else process.kill(-child.pid, 'SIGKILL')
}

/** One of the guide's commands, through the platform's shell, as written. */
function runStep(step, env, limit) {
  return new Promise((resolve) => {
    const began = Date.now()
    const child = spawn(step.command, { shell: true, cwd: repo, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      stop(child)
    }, limit)
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr, timedOut, seconds: (Date.now() - began) / 1000 })
    })
  })
}

const seconds = (value) => value.toFixed(1)

/** The step table and image sizes, as Markdown: what 0032 quotes, printed and, on GitHub, put in the job summary. */
function report({ when, on, timings, sizes, outcome }) {
  const lines = [
    '### Getting started, as the guide runs it',
    '',
    `${when}, ${on}. ${outcome}`,
    '',
    '| Step | Seconds |',
    '| --- | ---: |',
    ...timings.map((timing) => `| ${timing.name} | ${seconds(timing.seconds)} |`),
  ]
  if (sizes.length > 0) {
    lines.push(
      '',
      'Image sizes in bytes: `.Size` from `docker image inspect`, as this machine\'s image store counts it, and the layers unpacked, summed from `docker history`:',
      '',
      '| Image | `.Size` | Unpacked |',
      '| --- | ---: | ---: |',
      ...sizes.map((size) => `| \`${size.image}\` | ${size.bytes.toLocaleString('en-US')} | ${size.unpacked.toLocaleString('en-US')} |`),
    )
  }
  return `${lines.join('\n')}\n`
}

/**
 * PostgreSQL told to log every statement, and every statement's duration,
 * from now on -- kept in the data volume, so through every later start too.
 * A seed that sends a password in a statement's text then puts it in
 * `docker compose logs postgres`, where the leak check looks: the settings a
 * deployment might turn on for an audit of its own, which the seed must
 * survive. The gate's own command, not the guide's.
 */
function logEveryStatement(env) {
  const psql = ['exec', '-T', 'postgres', 'psql', '-U', 'formancy', '-d', 'formancy_data', '-v', 'ON_ERROR_STOP=1', '-X', '-q']
  for (const statement of ["alter system set log_statement = 'all'", 'alter system set log_min_duration_statement = 0', 'select pg_reload_conf()']) {
    compose(env, [...psql, '-c', statement])
  }
}

/** The port nginx sends the server's requests to, from deploy/web/nginx.conf. */
function serverPort() {
  const port = /proxy_pass\s+http:\/\/server:(\d+)/.exec(readHostFile(join(repo, 'deploy', 'web', 'nginx.conf')))?.[1]
  if (port === undefined) throw new Error('deploy/web/nginx.conf sends nothing to the server, so the gate cannot tell its port')
  return port
}

async function main() {
  const when = new Date().toISOString()
  const journey = readJourney()
  const guide = readFileSync(GUIDE, 'utf8')
  const { run } = extractSteps(guide)
  const { start, before, keep, last } = plan(run)
  const diagnostics = inlineCommands(guide, run)

  const [web, pg, ms] = [await freePort(), await freePort(), await freePort()]
  const env = { ...process.env }
  // Settings of the caller's that would change what the guide's commands mean.
  for (const name of ['COMPOSE_FILE', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES', 'COMPOSE_PATH_SEPARATOR', 'DOCKER_DEFAULT_PLATFORM']) delete env[name]
  Object.assign(env, {
    COMPOSE_PROJECT_NAME: `formancy-data-gate-${randomBytes(4).toString('hex')}`,
    FORMANCY_DATA_WEB_PORT: String(web),
    FORMANCY_DATA_PG_PORT: String(pg),
    FORMANCY_DATA_MS_PORT: String(ms),
  })
  const base = `http://127.0.0.1:${String(web)}/`
  console.log(`Project ${env.COMPOSE_PROJECT_NAME}, the web front on ${base}`)

  const timings = []
  const outputs = []
  const known = { secrets: new Map(), tokens: new Map() }
  let config
  let sizes = []
  let on = 'on a machine the gate could not describe'
  let failure

  const timed = async (name, work) => {
    const began = Date.now()
    const result = await work()
    timings.push({ name, seconds: (Date.now() - began) / 1000 })
    return result
  }
  const fail = (sentence, problems) => {
    if (problems.length > 0) throw new Error(`${sentence}:\n- ${problems.join('\n- ')}`)
  }
  const step = async (entry, name, { record = true } = {}) => {
    console.log(`\n> line ${String(entry.line)}: ${entry.command}`)
    const limit = entry === start ? START_LIMIT : STEP_LIMIT
    const result = await runStep(entry, env, limit)
    timings.push({ name: `${name} \`${entry.command}\``, seconds: result.seconds })
    // A diagnostic's output is what the operator asked to see -- a password,
    // for one of them -- so it is kept out of the leak check, and printed
    // only redacted, after a failure.
    if (record) outputs.push({ step: entry, ...result })
    if (result.timedOut || result.status !== 0) {
      const why = result.timedOut ? `did not finish within ${String(limit / 60_000)} minutes` : `exited ${String(result.status)}`
      const error = new Error(`the guide's command on line ${String(entry.line)} ${why}`)
      error.step = result
      throw error
    }
    console.log(`  ${seconds(result.seconds)} s`)
    return result
  }
  const leakCheck = (name) =>
    timed(name, async () => {
      for (const [secret, value] of readSecrets(env, config)) known.secrets.set(secret, value)
      const places = [
        ...haystacks(env, config, JSON.stringify(config)),
        ...outputs.map((output) => ({ where: `the output of the guide's step on line ${String(output.step.line)}`, text: `${output.stdout}${output.stderr}`, mints: output.mints })),
      ]
      fail('a secret or a token reached somewhere it must not', leaks({ ...known, haystacks: places }))
    })
  const createdIn = (form) => {
    const log = compose(env, ['logs', '--no-color', '--no-log-prefix', 'server']).stdout
    return auditEvents(log).filter((event) => event.operation === 'create' && event.form === form.formId && event.status === 201).length
  }

  try {
    on = machine()
    config = JSON.parse(compose(env, ['config', '--format', 'json']).stdout)
    await timed('Gate: compose configuration', async () => {
      fail('the composed configuration is not what 0032 and the guide say', [...configProblems(config), ...bindMountProblems(config)])
    })

    for (const entry of before) await step(entry, entry === start ? 'Start' : 'Step')
    await timed('Gate: PostgreSQL logs every statement from here on', async () => logEveryStatement(env))
    await step(start, 'Start again')
    await timed('Gate: no volume the configuration does not name', async () => {
      fail("a container mounts a volume compose.yaml does not name, and the guide's stop and start would leave one behind each time", anonymousMountProblems(projectContainers(env), config))
    })

    // The tokens are what the guide's commands printed, and nothing the gate made.
    const tokens = {}
    const adminRoles = (config.services?.server?.environment?.FORMANCY_DATA_ADMIN_ROLES ?? '').split(',').map((role) => role.trim())
    for (const output of outputs) {
      const printed = output.stdout.trim()
      if (!JWT.test(printed)) continue
      const who = await call(base, 'GET', '/v1/whoami', { token: printed })
      if (who.status !== 200) throw new Error(`the token printed by line ${String(output.step.line)} is refused (${String(who.status)}) by the stack it was minted for`)
      const name = classify(who.json, { adminRoles, clerkRole: journey.policy.operations.read[0] })
      if (name !== undefined && tokens[name] === undefined) {
        tokens[name] = printed
        known.tokens.set(name, printed)
        output.mints = name
      }
    }
    for (const name of Object.keys(MISSING)) if (tokens[name] === undefined) throw new Error(MISSING[name])

    await timed('Gate: the secrets each service can read', async () => {
      const problems = []
      for (const [name, running] of [['server', true], ['token', false]]) {
        const named = namedSecretFiles(config.services[name], readHostFile)
        problems.push(...exposureProblems(name, named, readableSecretFiles(env, name, named, { running })))
      }
      fail('a service can read a secret it has no use for', problems)
    })
    await timed('Gate: pages and assets', async () => fail('the web front does not serve what the pages name', await pageProblems(base)))
    const records = new Map()
    for (const form of journey.forms) records.set(form, await timed(`Gate: journey on ${form.engine}`, () => journeyFor(base, tokens, form, journey)))
    // What each composed database answered, through the product's own
    // adapter, kept for the release report beside every suite's (0035).
    await timed('Gate: each database, as the server reports it', async () => {
      for (const form of journey.forms) writeServerRecord(await composedServer(base, tokens.admin, form, config))
    })

    await timed("Gate: section 7's commands, against the running stack", async () => {
      const services = servicesWithContainers(env)
      for (const entry of diagnostics) {
        const result = await step(entry, 'Section 7', { record: false })
        // `ps` is how the guide has an operator find the service that is not
        // running, and a seed that failed has exited: it is listed only with -a.
        if (/\sps(\s|$)/.test(entry.command)) {
          const missing = services.filter((service) => !new RegExp(`(^|\\s)${service}(\\s|$)`, 'm').test(result.stdout))
          fail(`the guide's \`${entry.command}\` on line ${String(entry.line)} does not list every service that ran`, missing)
        }
      }
    })
    if (process.platform === 'linux') {
      await timed('Gate: the server at its container address', async () => {
        // Section 8 says a local process on a Linux host reaches the server
        // directly, past nginx. Should that stop being so, the sentence goes.
        const port = serverPort()
        const answers = await Promise.all(containerAddresses(env, 'server').map((address) => directStatus(address, port, '/health')))
        if (!answers.includes(200)) throw new Error(`the server did not answer at its container address (${answers.join(', ') || 'none'}), which the guide's section 8 says a local process on a Linux host reaches`)
      })
    }
    await leakCheck('Gate: leak check')
    await timed('Gate: the audit trail in the server log', async () => {
      fail("the server's log holds no audit event for the journey's create, which the guide's section 8 says is where the trail is", journey.forms.filter((form) => createdIn(form) === 0).map((form) => form.formId))
    })

    for (const entry of keep) {
      await step(entry, 'Stop')
      await step(start, 'Start after the stop')
      await timed('Gate: everything as it was', async () => {
        for (const [name, token] of Object.entries(tokens)) {
          const who = await call(base, 'GET', '/v1/whoami', { token })
          if (who.status !== 200) {
            throw new Error(`the ${name} token is refused (${String(who.status)}) after \`${entry.command}\` and a start: the guide says the secrets are kept, and the key that signed it was not`)
          }
        }
        for (const [form, record] of records) await stillThere(base, tokens, form, record, journey)
        fail(`the server's log still holds the audit events of before \`${entry.command}\`, which the guide's section 8 says it removes`, journey.forms.filter((form) => createdIn(form) > 0).map((form) => form.formId))
      })
      await leakCheck('Gate: leak check after the start')
    }
    sizes = imageSizes(config)
    await step(last, 'Stop and delete')
    fail(`\`${last.command}\` left volumes of the project behind, where the guide says it deletes them`, projectVolumes(env))
  } catch (error) {
    failure = error
  }

  if (failure !== undefined) {
    // Redacted with every secret and token the gate knows of, and only then
    // printed: a check that failed because something leaked must not print it.
    if (known.secrets.size === 0 && config !== undefined) {
      try {
        for (const [name, value] of readSecrets(env, config)) known.secrets.set(name, value)
      } catch {
        // No volume to read, or none readable: there is nothing of it to redact.
      }
    }
    const step = failure.step
    if (step !== undefined) console.error(redact(`\n${step.stderr}\n${step.stdout}`, known))
    const logs = compose(env, ['logs', '--no-color', '--tail', '80'], { allowFailure: true })
    const ps = compose(env, ['ps', '-a'], { allowFailure: true })
    console.error(redact(`\n${ps.stdout ?? ''}\n${logs.stdout ?? ''}${logs.stderr ?? ''}`, known))
  }
  const teardown = compose(env, ['down', '-v', '--remove-orphans'], { allowFailure: true, timeout: 300_000 })
  if (teardown.status !== 0) console.error(`Could not remove the gate's project ${env.COMPOSE_PROJECT_NAME}: ${(teardown.stderr ?? '').trim()}`)

  const outcome = failure === undefined ? 'Passed on both engines.' : 'Failed.'
  const table = report({ when, on, timings, sizes, outcome })
  console.log(`\n${table}`)
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`)
  if (failure !== undefined) {
    console.error(`\nThe guide does not work: ${redact(failure.message, known)}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`The guide cannot be run: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
