// `pnpm test:cloudflare`: the Cloudflare overlay, offline (0037).
//
// Nothing here can reach a Cloudflare account, so what is checked is what
// can be checked without one, on the real binary and the real server:
//
//  1. what Compose resolves both files to: 0032's checks of the composed
//     stack, 0071's of whom its server trusts as a proxy -- cloudflared at
//     the address it names -- plus the overlay's own (scripts/cloudflare/gate.mjs) -- it
//     changes no service of compose.yaml, pins cloudflared by tag and
//     digest, the one the tools copy their binary from, and gives it no
//     token and the flags the guide names -- and no image's VOLUME left
//     uncovered;
//  2. the guide's commands, each naming both files and only services and
//     profiles they have;
//  3. the configure step, in a project of its own: the tools image built,
//     a credentials file with a random id and secret put in the tunnel's
//     volume, `tunnel-config` run as the guide runs it, with a host
//     application's service and without; the file it writes is
//     ingress.mjs's rendering, cloudflared's and readable by it alone;
//     wrong inputs exit 1 with their sentence and leave it as it was; and
//     cloudflared, as the overlay runs it, reads it and its credentials
//     with no network, with the flags it was given;
//  4. the configuration's meaning, asked of the pinned cloudflared in the
//     tools image: valid, and every probe on the rule doors.json gives;
//  5. the differential: every hostile path (ingress.mjs) cloudflared sends
//     to the runtime door goes over a real socket to the built server with
//     an administrator's token, and must be refused 400 path-not-plain with
//     the token never read; for every administrator route and every file
//     location of nginx.conf a climb was built for, at least one reached the
//     runtime door, so the step is shown to exercise the refusal; then each
//     goes again through the service the runtime rule names, nginx.conf in
//     the web front's nginx in front of the built server
//     (scripts/cloudflare/web-front.mjs), and must end at the server's
//     refusal or nginx's own 404, never at a file or a route's work, while
//     every runtime route's sample reaches the server;
//  6. the tunnel's secret in none of what any of it printed.
//
// Then the image digests, the counts and each step's time, printed and, on
// GitHub, in the job summary. Its own Compose project, removed with its
// volume however it ends. It needs `pnpm build` of the server first.

import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hostilePaths, ingressYaml, probes, rules, SERVICES } from '../deploy/cloudflare/ingress.mjs'
import { DOORS, EXAMPLE, GUIDE } from './cloudflare/doors.mjs'
import {
  cloudflareProblems,
  DOCKERFILE,
  FILES,
  guideCommandProblems,
  imageVolumeProblems,
  NGINX_CONF,
  staticLocations,
  TUNNEL_VOLUME,
  WEB_DOCKERFILE,
  webFrontImage,
  webPort,
} from './cloudflare/gate.mjs'
import { STAND_IN, startWebFront } from './cloudflare/web-front.mjs'
import { bindMountProblems, configProblems } from './getting-started/stack.mjs'
import { trustProblems } from './getting-started/trust.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(repo, path), 'utf8')
const PROFILES = ['--profile', 'stack', '--profile', 'tools', '--profile', 'cloudflare']
const CONFIG = '/etc/formancy-cloudflare/config.yml'
const NOT_PLAIN = 'path-not-plain'

/** `docker compose` with both files, or compose.yaml alone (`base`), for the gate's project. */
function compose(env, args, { input, allowFailure = false, timeout = 120_000, base = false } = {}) {
  const files = base ? ['-f', 'compose.yaml'] : FILES
  const result = spawnSync('docker', ['compose', ...files, ...PROFILES, ...args], {
    cwd: repo,
    env,
    input,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (!allowFailure && (result.error !== undefined || result.status !== 0)) {
    throw new Error(
      `docker compose ${args.slice(0, 4).join(' ')} failed${result.error === undefined ? '' : ` (${result.error.message})`}: ${(result.stderr ?? '').trim()}`,
    )
  }
  return result
}

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (!allowFailure && result.status !== 0) throw new Error(`docker ${args.slice(0, 2).join(' ')} failed: ${(result.stderr ?? '').trim()}`)
  return result
}

const fail = (sentence, problems) => {
  if (problems.length > 0) throw new Error(`${sentence}:\n- ${problems.join('\n- ')}`)
}

/** Run in the tools image beside the volume: validate the configuration in use, then ask cloudflared about each URL on standard input. */
const MATCHER = `
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { matchAll } from '/deploy/cloudflare/configure.mjs'
const urls = JSON.parse(readFileSync(0, 'utf8'))
const validate = spawnSync('cloudflared', ['tunnel', '--config', '${CONFIG}', 'ingress', 'validate'], { encoding: 'utf8' })
const version = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' })
process.stdout.write(JSON.stringify({ version: version.stdout.trim(), validate: { status: validate.status, said: validate.stdout + validate.stderr }, answers: matchAll('cloudflared', '${CONFIG}', urls) }))
`

/** The `code` of a JSON body, or undefined when the body is not JSON with one. */
function codeOf(body) {
  try {
    const code = JSON.parse(body)?.code
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

/** One request with its target exactly as written, on a connection of its own. */
function send(port, method, target, headers) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path: target, headers, agent: false }, (incoming) => {
      let body = ''
      incoming.setEncoding('utf8')
      incoming.on('data', (chunk) => (body += chunk))
      incoming.on('end', () => resolve({ status: incoming.statusCode, body }))
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

/** The built server with both planes, a temporary store and an administrator's token it accepts, listening on loopback; every token it is asked about and every audit event it emits, kept. */
async function builtServer() {
  const server = await import(pathToFileURL(join(repo, 'packages', 'data-server', 'dist', 'index.mjs')).href)
  const scratch = mkdtempSync(join(tmpdir(), 'formancy-data-cf-gate-'))
  const asked = []
  const events = []
  const store = server.createFileConfigurationStore(scratch)
  const registry = server.createConnectionRegistry([], {})
  const audit = { sink: (event) => void events.push(event) }
  const app = await server.createDataServer({
    verifyIdentity: async (token) => {
      asked.push(token)
      return token === 'admin' ? { ok: true, identity: { actor: { id: 'gate', roles: ['data-admin'] }, attributes: {} } } : { ok: false, reason: 'no' }
    },
    admin: { registry, store, adminRoles: ['data-admin'], audit },
    runtime: { registry, store, audit },
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  return {
    port: app.server.address().port,
    asked,
    events,
    close: async () => {
      await app.close()
      rmSync(scratch, { recursive: true, force: true })
    },
  }
}

const seconds = (ms) => (ms / 1000).toFixed(1)

async function main() {
  const when = new Date().toISOString()
  const env = { ...process.env }
  for (const name of ['COMPOSE_FILE', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES', 'COMPOSE_PATH_SEPARATOR', 'DOCKER_DEFAULT_PLATFORM']) delete env[name]
  env.COMPOSE_PROJECT_NAME = `formancy-data-cf-${randomBytes(4).toString('hex')}`
  const doors = JSON.parse(read(DOORS))
  const statics = staticLocations(read(NGINX_CONF))
  const inputs = { admin: EXAMPLE.admin, team: EXAMPLE.team, aud: EXAMPLE.aud, app: EXAMPLE.app }
  const id = randomUUID()
  // Random per run, so "the secret is in no output" cannot pass because the
  // output happens to avoid one fixed string.
  const secret = randomBytes(32).toString('base64')
  const outputs = []
  const timings = []
  const facts = {}
  const runner = `cloudflared-${env.COMPOSE_PROJECT_NAME}`
  let failure
  const timed = async (name, work) => {
    const began = Date.now()
    try {
      return await work()
    } finally {
      timings.push({ name, ms: Date.now() - began })
    }
  }
  /** A tools container, its output kept for the secret check. */
  const tool = (args, input) => {
    const result = compose(env, ['run', '--rm', '-T', ...args], { input, allowFailure: true, timeout: 300_000 })
    outputs.push({ where: `run ${args.filter((arg) => !arg.includes('\n')).join(' ')}`, text: `${result.stdout ?? ''}${result.stderr ?? ''}` })
    return result
  }
  const configureArgs = (given) => [
    '--admin',
    given.admin,
    '--team',
    given.team,
    '--aud',
    given.aud,
    ...(given.app === undefined ? [] : ['--app', given.app]),
    ...(given.appService === undefined ? [] : ['--app-service', given.appService]),
    ...(given.drop === undefined ? [] : ['--drop', given.drop]),
  ]
  const inVolume = (script) => tool(['--entrypoint', 'sh', 'tunnel-config', '-c', script])
  const ask = (urls) => {
    const result = tool(['--entrypoint', 'node', 'tunnel-config', '--input-type=module', '-e', MATCHER], JSON.stringify(urls))
    if (result.status !== 0) throw new Error(`cloudflared could not be asked in the tools image: ${(result.stderr ?? '').trim()}`)
    return JSON.parse(result.stdout)
  }

  try {
    console.log(`Project ${env.COMPOSE_PROJECT_NAME}`)
    const config = JSON.parse(compose(env, ['config', '--format', 'json']).stdout)
    const base = JSON.parse(compose(env, ['config', '--format', 'json'], { base: true }).stdout)
    await timed('1. Resolved configuration', async () => {
      fail('the overlay is not what 0037 and 0071 say', [
        ...configProblems(config),
        ...bindMountProblems(config),
        ...cloudflareProblems(config, base, read(DOCKERFILE)),
        ...trustProblems(config),
      ])
    })
    await timed("2. The guide's commands", async () => fail(`${GUIDE}'s commands do not fit the overlay`, guideCommandProblems(read(GUIDE), config, GUIDE)))

    await timed('3. Build the tools, pull cloudflared', async () => {
      compose(env, ['build', 'tunnel-config'], { timeout: 900_000 })
      compose(env, ['pull', 'cloudflared'], { timeout: 900_000 })
    })
    const images = [config.services.cloudflared.image, config.services['tunnel-config'].image]
    for (const image of images) facts[image] = JSON.parse(docker(['image', 'inspect', image]).stdout)[0]
    fail(
      'an image declares a volume its service mounts nothing over',
      imageVolumeProblems(config, base, Object.fromEntries(images.map((image) => [image, facts[image].Config?.Volumes ?? null]))),
    )

    await timed('3. The configure step, offline', async () => {
      const credentials = JSON.stringify({ AccountTag: randomBytes(16).toString('hex'), TunnelSecret: secret, TunnelID: id })
      if (tool(['--entrypoint', 'sh', 'tunnel-config', '-c', 'umask 077 && cat > /etc/formancy-cloudflare/credentials.json'], credentials).status !== 0)
        throw new Error('the credentials could not be put in the volume')
      const configured = (given, expected) => {
        const result = tool(['tunnel-config', ...configureArgs(given)])
        if (result.status !== 0) throw new Error(`tunnel-config exited ${String(result.status)}: ${(result.stderr ?? '').trim()}`)
        const written = inVolume(`cat ${CONFIG}`).stdout
        if (written !== expected) throw new Error(`tunnel-config wrote a configuration other than ingress.mjs renders for ${JSON.stringify(given)}`)
        return result
      }
      configured({ ...inputs, appService: EXAMPLE.appService }, ingressYaml(doors, { ...inputs, appService: EXAMPLE.appService }, id))
      const kept = ingressYaml(doors, inputs, id)
      // Without the host application's own service again: refused unless
      // --drop names its hostname, so a door is never closed unasked.
      const refused = tool(['tunnel-config', ...configureArgs(inputs)])
      if (refused.status !== 1 || !(refused.stderr ?? '').includes(`--drop ${inputs.app}`))
        throw new Error(`tunnel-config without --app-service exited ${String(refused.status)} without naming --drop ${inputs.app}`)
      configured({ ...inputs, drop: inputs.app }, kept)
      const owners = inVolume("stat -c '%u:%g %a %n' /etc/formancy-cloudflare/config.yml /etc/formancy-cloudflare/credentials.json").stdout.trim().split('\n')
      fail(
        'the tunnel’s files are not cloudflared’s alone',
        owners.filter((line) => !line.startsWith('65532:65532 400 ')),
      )
      for (const [why, given, sentence] of [
        ['an upper-case hostname', { ...inputs, admin: 'Formancy.example.com' }, 'has upper-case letters'],
        ['a 63-character AUD tag', { ...inputs, aud: inputs.aud.slice(1) }, '64 lower-case hexadecimal characters'],
      ]) {
        const result = tool(['tunnel-config', ...configureArgs(given)])
        if (result.status !== 1 || !(result.stderr ?? '').includes(sentence))
          throw new Error(`tunnel-config with ${why} exited ${String(result.status)} without saying "${sentence}"`)
        if (inVolume(`cat ${CONFIG}`).stdout !== kept) throw new Error(`tunnel-config with ${why} changed the configuration in use`)
      }
    })

    await timed('3. cloudflared, as configured, reads its files', async () => {
      // With no network: it reads the configuration and the credentials as
      // its own user from the read-only volume, says its settings, and
      // fails to reach Cloudflare, which is where this stops it.
      const service = config.services.cloudflared
      const volume = `${env.COMPOSE_PROJECT_NAME}_${TUNNEL_VOLUME}`
      const mount = service.volumes.find((entry) => entry.source === TUNNEL_VOLUME)
      docker(['run', '-d', '--name', runner, '--network', 'none', '-v', `${volume}:${mount.target}:ro`, service.image, ...service.command])
      let said = ''
      for (let waited = 0; waited < 30 && !/Settings: map\[/.test(said); waited += 1) {
        spawnSync('sleep', ['1'])
        said = `${docker(['logs', runner], { allowFailure: true }).stdout}${docker(['logs', runner], { allowFailure: true }).stderr}`
      }
      docker(['rm', '-f', runner], { allowFailure: true })
      outputs.push({ where: 'cloudflared’s log', text: said })
      const settings = /Settings: map\[([^\]]*)\]/.exec(said)?.[1] ?? ''
      facts.settings = settings
      const wanted = ['loglevel:info', 'management-diagnostics:false', 'metrics:127.0.0.1:20241', 'no-autoupdate:true', `config:${CONFIG}`]
      fail('cloudflared, run as the overlay runs it, did not start on the configuration with its flags', [
        ...(said.includes(`tunnelID=${id}`) ? [] : [`it never said it was starting tunnel ${id}: ${said.split('\n').slice(0, 3).join(' ')}`]),
        ...wanted.filter((entry) => !settings.split(' ').includes(entry)).map((entry) => `its settings lack ${entry}`),
        ...(/permission denied/i.test(said) ? ['it could not read a file of the volume'] : []),
      ])
    })

    const order = rules(inputs)
    await timed('4. The configuration’s meaning, under cloudflared', async () => {
      const expected = probes(doors, inputs)
      const answer = ask(expected.map((probe) => probe.url))
      facts.version = answer.version
      facts.probes = expected.length
      if (answer.validate.status !== 0 || !/^OK$/m.test(answer.validate.said))
        throw new Error(`cloudflared refused the generated configuration: ${answer.validate.said.trim()}`)
      fail(
        'cloudflared matches the generated configuration differently from doors.json',
        expected.flatMap((probe, index) =>
          answer.answers[index].rule === probe.rule
            ? []
            : [`${probe.url} matched ${String(answer.answers[index].rule ?? answer.answers[index].said)}, not rule #${String(probe.rule)}: ${probe.why}`],
        ),
      )
    })

    let forwarded = []
    await timed('5. The differential: hostile paths through cloudflared to the built server', async () => {
      const hostile = hostilePaths(doors, { statics })
      const answer = ask(hostile.map((entry) => `https://${inputs.app}${entry.path}`))
      forwarded = hostile.filter((_, index) => answer.answers[index].rule === order.runtime)
      facts.hostile = hostile.length
      facts.forwarded = forwarded.length
      const climbed = new Set(hostile.filter((entry) => entry.route !== null).map((entry) => entry.route))
      const reached = new Set(forwarded.map((entry) => entry.route))
      const server = await builtServer()
      const problems = []
      try {
        for (const entry of forwarded) {
          const reply = await send(server.port, entry.method, entry.path, { authorization: 'Bearer admin' })
          let code
          try {
            code = JSON.parse(reply.body).code
          } catch {
            code = undefined
          }
          if (reply.status !== 400 || code !== NOT_PLAIN)
            problems.push(
              `${entry.method} ${entry.path}, which cloudflared sends to the runtime door, was answered ${String(reply.status)} ${String(code)} by the server`,
            )
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
        const ran = server.events.filter((event) => event.outcome !== NOT_PLAIN)
        problems.push(
          ...[...new Set(ran.map((event) => `${String(event.plane)} ${String(event.operation)}`))].map(
            (operation) => `the ${operation} route ran for a path cloudflared sends to the runtime door`,
          ),
        )
        if (server.asked.length > 0) problems.push(`the server read the token for ${String(server.asked.length)} of them, so a route's work began`)
      } finally {
        await server.close()
      }
      problems.push(
        ...[...climbed]
          .filter((route) => !reached.has(route))
          .map((route) => `no climb from ${route} reached the runtime door under cloudflared, so this step shows nothing of the refusal for it`),
      )
      fail('a path the runtime door forwards reached a route of the server', problems)
    })

    await timed('5. The runtime door through the web front', async () => {
      // What cloudflared forwards goes to the service the runtime rule
      // names, which is nginx, not the server: so each forwarded path is
      // sent on to nginx.conf in the web front's own nginx, in front of the
      // built server, and must end at the server's path-not-plain or at
      // nginx's own 404, never at a file or a route's work. And every
      // runtime route's sample, sent there without a token, must reach the
      // server, which asks for one: the door forwards what it is for.
      const port = webPort(SERVICES.runtime)
      const front = await startWebFront({
        name: `${env.COMPOSE_PROJECT_NAME}-front`,
        toolsImage: config.services['tunnel-config'].image,
        nginxImage: webFrontImage(read(WEB_DOCKERFILE)),
        repo,
        conf: join(repo, NGINX_CONF),
        statics,
      })
      const problems = []
      try {
        const published = front.port(port)
        for (const entry of forwarded) {
          const reply = await send(published, entry.method, entry.path, { authorization: 'Bearer admin' })
          const code = codeOf(reply.body)
          const refused = reply.status === 400 && code === NOT_PLAIN
          const nginx404 = reply.status === 404 && code === undefined && !reply.body.includes(STAND_IN)
          if (!refused && !nginx404)
            problems.push(
              `${entry.method} ${entry.path}, which cloudflared sends to the runtime door, was answered ${String(reply.status)}${code === undefined ? '' : ` ${code}`} through the web front${reply.body.includes(STAND_IN) ? `, with the file ${reply.body.trim().split(': ').at(-1)}` : ''}`,
            )
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
        const lines = front.lines()
        const ran = lines.filter((line) => line.event !== undefined && line.event.outcome !== NOT_PLAIN)
        problems.push(
          ...[...new Set(ran.map((line) => `${String(line.event.plane)} ${String(line.event.operation)}`))].map(
            (operation) => `the ${operation} route ran for a path cloudflared sends to the runtime door, through the web front`,
          ),
        )
        const asked = lines.filter((line) => line.asked === true).length
        if (asked > 0) problems.push(`the server read a token for ${String(asked)} of them through the web front, so a route's work began`)
        for (const route of doors.routes.filter((entry) => entry.plane === 'runtime')) {
          const reply = await send(published, route.method, route.sample, {})
          if (reply.status !== 401 || codeOf(reply.body) !== 'unauthenticated')
            problems.push(
              `${route.method} ${route.sample}, a runtime route, was answered ${String(reply.status)} ${String(codeOf(reply.body))} through the runtime door's web front, not the server's 401`,
            )
        }
        facts.webFront = `${String(forwarded.length)} forwarded paths and ${String(doors.routes.filter((entry) => entry.plane === 'runtime').length)} runtime samples through nginx.conf's port ${String(port)}`
      } finally {
        front.close()
      }
      fail('the runtime door, through the web front, answered a path with a file or a route', problems)
    })

    await timed('6. The tunnel’s secret in no output', async () => {
      fail(
        'the tunnel’s secret was printed',
        outputs.filter((output) => output.text.includes(secret)).map((output) => output.where),
      )
    })
  } catch (error) {
    failure = error
  }

  docker(['rm', '-f', runner], { allowFailure: true })
  const teardown = compose(env, ['down', '-v', '--remove-orphans'], { allowFailure: true, timeout: 300_000 })
  if (teardown.status !== 0) console.error(`Could not remove the gate's project ${env.COMPOSE_PROJECT_NAME}: ${(teardown.stderr ?? '').trim()}`)

  const compose_ = spawnSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8' }).stdout.trim()
  const lines = [
    '### The Cloudflare overlay, offline',
    '',
    `${when}, Compose ${compose_}. ${failure === undefined ? 'Passed.' : 'Failed.'}`,
    '',
    ...Object.entries(facts)
      .filter(([, value]) => typeof value === 'object')
      .map(([image, value]) => `- \`${image}\`: ${(value.RepoDigests ?? []).join(', ') || value.Id}`),
    ...(facts.version === undefined
      ? []
      : [
          `- ${facts.version}; ${String(facts.probes)} probes; ${String(facts.forwarded)} of ${String(facts.hostile)} hostile paths sent to the runtime door${failure === undefined ? ', each refused by the server' : ''}`,
        ]),
    ...(facts.webFront === undefined ? [] : [`- ${facts.webFront}${failure === undefined ? ", each refused, 404 or the server's 401" : ''}`]),
    ...(facts.settings === undefined ? [] : [`- cloudflared's settings as it started: \`${facts.settings}\``]),
    '',
    '| Step | Seconds |',
    '| --- | ---: |',
    ...timings.map((timing) => `| ${timing.name} | ${seconds(timing.ms)} |`),
  ]
  const table = `${lines.join('\n')}\n`
  console.log(`\n${table}`)
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`)
  if (failure !== undefined) {
    console.error(`\nThe Cloudflare gate failed: ${failure.message.replaceAll(secret, '[the tunnel secret]')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`The Cloudflare gate could not run: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
