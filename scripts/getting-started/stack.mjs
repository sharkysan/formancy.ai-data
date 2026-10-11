// The composed stack from outside, for scripts/getting-started.mjs (0032):
// running compose for the gate's own project, and the checks that look at the
// stack rather than through its API -- what compose was configured with and
// what each service reads from the checkout, which secrets the server and the
// minter can read, what the web front serves, what the server's log holds of
// the audit trail, and whether a secret or a token reached anywhere an
// operator or a log collector would read it.
//
// Node built-ins only, like the gate: it runs from a checkout with nothing
// installed. The name of the notices file comes from the plugin that writes
// it, ../third-party-notices.mjs, which imports nothing else either. The
// pure checks take what compose printed and return problems, so
// stack.test.mjs can hold them to cases without Docker.

import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { NOTICES_FILE } from '../third-party-notices.mjs'

/** Every profile, so compose describes, logs and tears down every service the guide can start. */
const PROFILES = ['--profile', 'stack', '--profile', 'tools']

/**
 * `docker compose` for the gate's project, with the gate's environment. Not
 * through a shell: these are the gate's commands, not the guide's. Throws a
 * sentence with compose's own stderr when it fails, unless `allowFailure`.
 */
export function compose(env, args, { allowFailure = false, timeout = 120_000 } = {}) {
  const result = spawnSync('docker', ['compose', ...PROFILES, ...args], { env, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 })
  if (!allowFailure && (result.error !== undefined || result.status !== 0)) {
    throw new Error(`docker compose ${args.join(' ')} failed${result.error === undefined ? '' : ` (${result.error.message})`}: ${(result.stderr ?? '').trim()}`)
  }
  return result
}

/** `docker` itself, for what compose does not answer: inspect, image sizes, the engine's version. */
export function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.error !== undefined || result.status !== 0) throw new Error(`docker ${args.join(' ')} failed: ${(result.stderr ?? result.error?.message ?? '').trim()}`)
  return result.stdout
}

/** A setting whose name says it holds a secret. */
const SECRET_NAME = /PASSWORD|SECRET|KEY|TOKEN/i

/**
 * What is wrong with compose's resolved configuration, in sentences that
 * never quote a value:
 *
 * - a port published anywhere but loopback reaches the machine's network,
 *   which this unauthenticated-at-the-edge demo must not;
 * - a published server port is a second origin beside the proxy, which 0024
 *   and 0029 rule out for the browser;
 * - a setting named like a secret holds anything but a `file:` reference or
 *   a `_FILE` setting naming an absolute path. A value is printed by `docker
 *   compose config` and `docker inspect` to anybody who runs them, and an
 *   `env:` reference is only as good as the variable it names, which can hold
 *   the key itself under a name nothing here would read as a secret's;
 * - a service restarts on its own, which the guide's section 8 says none
 *   does.
 */
export function configProblems(config) {
  const problems = []
  for (const [name, service] of Object.entries(config.services ?? {})) {
    for (const port of service.ports ?? []) {
      if (name === 'server') problems.push(`server publishes port ${String(port.target)}; the browser's way in is web, on one origin`)
      else if (port.host_ip !== '127.0.0.1') problems.push(`${name} publishes port ${String(port.target)} on ${port.host_ip ?? 'every interface'}, not on 127.0.0.1`)
    }
    for (const [setting, value] of Object.entries(service.environment ?? {})) {
      if (!SECRET_NAME.test(setting)) continue
      const text = value ?? ''
      const reference = text.startsWith('file:/')
      const fileSetting = setting.endsWith('_FILE') && text.startsWith('/')
      if (!reference && !fileSetting) {
        problems.push(`${name}'s ${setting} holds a value of its own; a secret here is a file: reference or a _FILE setting, naming an absolute path`)
      }
    }
    if (service.restart !== undefined && service.restart !== 'no') {
      problems.push(`${name} restarts on its own (restart: ${String(service.restart)}), and the guide's section 8 says nothing does`)
    }
  }
  return problems
}

/** Root reads a bind mount whatever its mode; any other user needs the bits for others. */
const runsAsRoot = (service) => ['0', 'root', '0:0', 'root:root'].includes(String(service.user ?? ''))

/** The first path under `path`, itself included, that a user other than its owner cannot read; undefined when there is none. */
function unreadableByOthers(path) {
  const stat = statSync(path)
  if (!stat.isDirectory()) return (stat.mode & 0o004) === 0 ? path : undefined
  if ((stat.mode & 0o005) !== 0o005) return path
  for (const entry of readdirSync(path).sort()) {
    const found = unreadableByOthers(join(path, entry))
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Each file of the checkout a service that is not root reads through a bind
 * mount, and other users cannot: the container runs as its image's user
 * (node, mssql), which is not the host user who made the checkout, so a
 * clone made under a umask stricter than 022 stops it. Before anything
 * starts, so the sentence names the file rather than a log saying
 * "Permission denied".
 */
export function bindMountProblems(config) {
  const problems = []
  for (const [name, service] of Object.entries(config.services ?? {})) {
    if (runsAsRoot(service)) continue
    for (const mount of service.volumes ?? []) {
      if (mount.type !== 'bind') continue
      const found = unreadableByOthers(mount.source)
      if (found !== undefined) {
        problems.push(`${name} reads ${found}, which other users cannot read, as its image's user rather than root; the guide's section 0 asks for a checkout other users can read`)
      }
    }
  }
  return problems
}

/**
 * The absolute paths a service's configuration names as secrets: `file:`
 * references and `_FILE` settings in its environment, and the `file:`
 * passwords of the connections file compose mounts for it, read from the
 * checkout with `readHostFile`.
 */
export function namedSecretFiles(service, readHostFile) {
  const named = new Set()
  const environment = service.environment ?? {}
  for (const [setting, value] of Object.entries(environment)) {
    if (typeof value !== 'string') continue
    if (value.startsWith('file:/')) named.add(value.slice('file:'.length))
    else if (setting.endsWith('_FILE') && value.startsWith('/')) named.add(value)
  }
  const file = environment.FORMANCY_DATA_CONNECTIONS
  const mount = (service.volumes ?? []).find((volume) => volume.type === 'bind' && volume.target === file)
  if (mount !== undefined) {
    for (const entry of JSON.parse(readHostFile(mount.source))) {
      if (typeof entry.password === 'string' && entry.password.startsWith('file:/')) named.add(entry.password.slice('file:'.length))
    }
  }
  return named
}

/** A sentence for each secret file `service` can read that `named` does not hold: by path, never by contents. */
export function exposureProblems(service, named, readable) {
  return readable.filter((path) => !named.has(path)).map((path) => `${service} can read ${path}, which nothing in its configuration names`)
}

/**
 * Every file in the directories of `named` that `service` can read, as the
 * service's own user sees them: through `exec` into the running server, or a
 * container of the service run for this alone (the minter is never left
 * running). The listing is a script inside the container, the gate's own.
 */
export function readableSecretFiles(env, service, named, { running }) {
  const directories = [...new Set([...named].map((path) => dirname(path)))]
  const script = `for d in ${directories.join(' ')}; do for f in "$d"/*; do [ -f "$f" ] && [ -r "$f" ] && echo "$f"; done; done; true`
  const args = running ? ['exec', '-T', service, 'sh', '-c', script] : ['run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', service, '-c', script]
  return compose(env, args)
    .stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** The server's audit events, from its log's structured lines: what `logAuditSink` writes, one JSON object per line. */
export function auditEvents(logText) {
  const events = []
  for (const line of logText.split('\n')) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed !== null && typeof parsed === 'object' && parsed.audit !== null && typeof parsed.audit === 'object') events.push(parsed.audit)
  }
  return events
}

/** The addresses a service's containers have on compose's networks, from `docker inspect`. */
export function containerAddresses(env, service) {
  const ids = compose(env, ['ps', '-q', service]).stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  return ids.flatMap((id) => Object.values(JSON.parse(docker(['inspect', id]))[0]?.NetworkSettings?.Networks ?? {}).map((network) => network.IPAddress).filter((address) => typeof address === 'string' && address !== ''))
}

/**
 * Every service compose has a container for, running or exited. `ps --format
 * json` prints one array on older Compose releases and an object per line on
 * newer ones; both are read.
 */
export function servicesWithContainers(env) {
  const text = compose(env, ['ps', '-a', '--format', 'json']).stdout.trim()
  if (text === '') return []
  const entries = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
  return [...new Set(entries.map((entry) => entry.Service))]
}

/**
 * The status of a GET straight to `host`:`port`, on a socket of the gate's
 * own, as any local process would connect: not through fetch, which follows
 * a proxy the environment names (NODE_USE_ENV_PROXY) and would ask the proxy
 * instead. 'no answer' when nothing answers in ten seconds.
 */
export function directStatus(host, port, path) {
  return new Promise((resolve) => {
    const socket = connect({ host, port: Number(port) }, () => socket.write(`GET ${path} HTTP/1.0\r\nHost: ${host}\r\n\r\n`))
    let head = ''
    socket.setTimeout(10_000, () => {
      socket.destroy()
      resolve('no answer')
    })
    socket.on('data', (chunk) => {
      head += chunk
      if (!head.includes('\r\n')) return
      socket.destroy()
      resolve(Number(/^HTTP\/1\.\d (\d{3})/.exec(head)?.[1] ?? Number.NaN))
    })
    socket.on('error', () => resolve('no answer'))
    socket.on('close', () => resolve('no answer'))
  })
}

/** The volumes Docker still holds for the gate's project. */
export function projectVolumes(env) {
  return docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${env.COMPOSE_PROJECT_NAME}`])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** Every container of the gate's project, running or exited, as `docker inspect` describes it. */
export function projectContainers(env) {
  const ids = compose(env, ['ps', '-a', '-q']).stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  return ids.length === 0 ? [] : JSON.parse(docker(['inspect', ...ids]))
}

/**
 * Each volume a container mounts where its service's configuration mounts
 * nothing: a VOLUME its image declares, such as the postgres image's data
 * directory under a service that uses that image only for its sh or psql.
 * Docker makes such a volume anew for every container and labels it with no
 * project, so the guide's `down` keeps it, the next start makes another, and
 * `projectVolumes` after `down -v` cannot see the ones left behind.
 * `containers` is `docker inspect`'s, `config` compose's resolved one.
 */
export function anonymousMountProblems(containers, config) {
  const problems = []
  for (const container of containers) {
    const name = container.Config?.Labels?.['com.docker.compose.service']
    const service = config.services?.[name] ?? {}
    const configured = new Set((service.volumes ?? []).map((mount) => mount.target))
    for (const mount of container.Mounts ?? []) {
      if (!configured.has(mount.Destination)) {
        problems.push(`${name} mounts a volume at ${mount.Destination} that its configuration does not name, which the guide's \`down\` leaves behind for good`)
      }
    }
  }
  return problems
}

/** A file of the checkout, for the checks that read what compose mounts. */
export const readHostFile = (path) => readFileSync(path, 'utf8')

/**
 * Where each secret and token appears in `haystacks`, as sentences naming the
 * secret's file or the token's holder and the place, never the value.
 * `secrets` and `tokens` map a name to a value; a token is allowed where
 * `haystack.mints` names it, which is the guide's own command printing it.
 */
export function leaks({ secrets, tokens, haystacks }) {
  const found = []
  for (const haystack of haystacks) {
    for (const [name, value] of secrets) if (haystack.text.includes(value)) found.push(`the secret ${name} is in ${haystack.where}`)
    for (const [name, value] of tokens) if (haystack.mints !== name && haystack.text.includes(value)) found.push(`the ${name} token is in ${haystack.where}`)
  }
  return found
}

/** `text` with every secret and token replaced by its name, for output printed after a failure. */
export function redact(text, { secrets, tokens }) {
  let out = text
  for (const [name, value] of secrets) out = out.replaceAll(value, `[secret ${name}]`)
  for (const [name, value] of tokens) out = out.replaceAll(value, `[${name} token]`)
  return out
}

/** Short enough to turn up in a log by chance: a leak check against it would prove nothing. */
const SHORTEST_SECRET = 16

/**
 * Every secret the stack has, read one by one from the volume the `secrets`
 * service keeps them in (0032) -- the one place that holds all of them, since
 * each other service is handed only its own. Through a container of that
 * service run for this alone, so it needs nothing else running and works
 * after a failure too. Held in memory, never printed.
 */
export function readSecrets(env, config) {
  const store = (config.services?.secrets?.volumes ?? []).find((volume) => volume.type === 'volume' && volume.source === 'formancy-data-secrets')?.target
  if (store === undefined) throw new Error('compose.yaml gives the secrets service no formancy-data-secrets volume to read the secrets from')
  const through = (args) => compose(env, ['run', '--rm', '--no-deps', '-T', '--entrypoint', ...args], { allowFailure: true })
  const listed = through(['ls', 'secrets', '-1', store])
  if (listed.status !== 0) throw new Error('the secrets volume could not be listed')
  const secrets = new Map()
  for (const name of listed.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.endsWith('.new'))) {
    const read = through(['cat', 'secrets', `${store}/${name}`])
    if (read.status !== 0) throw new Error(`the secret ${name} could not be read from the volume`)
    const value = read.stdout.trim()
    if (value.length < SHORTEST_SECRET) throw new Error(`the secret ${name} is shorter than ${String(SHORTEST_SECRET)} characters, so a leak check for it would match by chance`)
    secrets.set(name, value)
  }
  if (secrets.size === 0) throw new Error('the secrets volume holds no secret to check for')
  return secrets
}

/** Everything an operator or a log collector reads: every service's log, the resolved configuration, and every container's inspect. */
export function haystacks(env, config, configText) {
  const found = [{ where: '`docker compose config`', text: configText }]
  for (const service of Object.keys(config.services ?? {})) {
    const logs = compose(env, ['logs', '--no-color', service], { allowFailure: true })
    found.push({ where: `the logs of ${service}`, text: `${logs.stdout ?? ''}${logs.stderr ?? ''}` })
  }
  const ids = compose(env, ['ps', '-a', '-q']).stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  for (const id of ids) {
    const inspected = docker(['inspect', id])
    const name = JSON.parse(inspected)[0]?.Name?.replace(/^\//, '') ?? id
    found.push({ where: `\`docker inspect\` of ${name}`, text: inspected })
  }
  return found
}

/**
 * Each image the stack runs, from the resolved configuration: the bytes
 * `docker image inspect` reports, and the sum of its layers unpacked, from
 * `docker history`. Both, because the first means different things on
 * different image stores -- the containerd store counts the compressed
 * layers too -- and only the second compares across machines.
 */
export function imageSizes(config) {
  const images = [...new Set(Object.values(config.services ?? {}).map((service) => service.image).filter((image) => typeof image === 'string'))]
  return images.map((image) => ({
    image,
    bytes: Number(docker(['image', 'inspect', '--format', '{{.Size}}', image]).trim()),
    unpacked: docker(['history', '--human=false', '--format', '{{.Size}}', image])
      .split('\n')
      .filter((line) => line.trim() !== '')
      .reduce((sum, line) => sum + Number(line.trim()), 0),
  }))
}

/** What a measurement in the step table was taken on. */
export function machine() {
  const [engine, platform] = docker(['version', '--format', '{{.Server.Version}}|{{.Server.Os}}/{{.Server.Arch}}']).trim().split('|')
  const [system, cpus, memory, driver] = docker(['info', '--format', '{{.OperatingSystem}}|{{.NCPU}}|{{.MemTotal}}|{{.Driver}}']).trim().split('|')
  const composeVersion = spawnSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8' }).stdout.trim()
  const gib = (Number(memory) / 1024 ** 3).toFixed(1)
  return `Docker Engine ${engine} on ${system} (${platform}, ${cpus} CPUs, ${gib} GiB, storage driver ${driver}), Compose ${composeVersion}`
}

/** Google Fonts, which the apps load from Google by design; the guide says so. */
const FONTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

const ATTRIBUTE = (name) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')

/** Every `<script src>` and `<link href>` of a page, as written. */
export function pageReferences(html) {
  const found = []
  for (const [tag, name] of html.matchAll(/<(script|link)\b[^>]*>/gis)) {
    const attribute = ATTRIBUTE(name.toLowerCase() === 'script' ? 'src' : 'href').exec(tag)
    if (attribute !== null) found.push({ tag: name.toLowerCase(), url: attribute[2] ?? attribute[3] ?? attribute[4] })
  }
  return found
}

/** Every `url(...)` and quoted `@import` of a stylesheet, as written. */
export function styleReferences(css) {
  const found = []
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) found.push(match[1] ?? match[2] ?? match[3])
  for (const match of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) found.push(match[1] ?? match[2])
  return found
}

const isScript = (type) => /^(text|application)\/javascript\b/i.test(type)
const isStyle = (type) => /^text\/css\b/i.test(type)

/**
 * What is wrong with how the web front answered for a page's third-party
 * notices (0046): the file each app's build writes beside its index.html,
 * served as text that says it is UTF-8 -- which nginx's `charset` makes it.
 * A browser left to guess the encoding of a bare text/plain can garble a
 * licence's accented name or copyright sign. Undefined when nothing is.
 */
export function noticesProblem(path, status, type) {
  if (status === 200 && /^text\/plain;\s*charset=utf-8$/i.test(type.trim())) return undefined
  return `${path} answered ${String(status)} ${type}, not 200 text/plain; charset=utf-8`
}

/** A GET as a browser's first request makes it: no redirect followed, the body read whole. */
async function get(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

/**
 * The web front as a browser meets it: `/` sends the browser to the studio,
 * anything else unknown is 404, both pages are HTML, and every script and
 * stylesheet they name -- and every file those stylesheets name -- is
 * served from this origin with its type, or is Google's fonts, or inline;
 * and beside each page, its third-party notices as UTF-8 text.
 * A build without its base, or a proxy rule that lost a path, fails here.
 * Returns problems, checking everything rather than stopping at the first.
 */
export async function pageProblems(base) {
  const problems = []
  const root = await get(new URL('/', base))
  const location = root.headers.get('location')
  if (root.status !== 302 || location === null || new URL(location, base).href !== new URL('/studio/', base).href) {
    problems.push(`/ answered ${String(root.status)} to ${location ?? 'nowhere'}, not 302 to /studio/`)
  }
  const unknown = await get(new URL('/nope', base))
  if (unknown.status !== 404) problems.push(`/nope answered ${String(unknown.status)}, not 404`)

  for (const path of ['/studio/', '/host/']) {
    const pageUrl = new URL(path, base)
    const noticesUrl = new URL(NOTICES_FILE, pageUrl)
    const notices = await get(noticesUrl)
    const noticesWrong = noticesProblem(noticesUrl.pathname, notices.status, notices.headers.get('content-type') ?? '')
    if (noticesWrong !== undefined) problems.push(noticesWrong)

    const page = await get(pageUrl)
    const type = page.headers.get('content-type') ?? ''
    if (page.status !== 200 || !/^text\/html\b/i.test(type)) {
      problems.push(`${path} answered ${String(page.status)} ${type}, not 200 text/html`)
      continue
    }
    for (const reference of pageReferences(page.text)) {
      if (reference.url.startsWith('data:')) continue
      const url = new URL(reference.url, pageUrl)
      if (url.origin !== pageUrl.origin) {
        if (reference.tag === 'script' || !FONTS.has(url.hostname)) problems.push(`${path} loads ${url.href}, which is neither this origin nor Google's fonts`)
        continue
      }
      const asset = await get(url)
      const assetType = asset.headers.get('content-type') ?? ''
      if (asset.status !== 200 || !(isScript(assetType) || isStyle(assetType))) {
        problems.push(`${path} names ${url.pathname}, which answered ${String(asset.status)} ${assetType}, not 200 JavaScript or CSS`)
        continue
      }
      if (!isStyle(assetType)) continue
      for (const inner of styleReferences(asset.text)) {
        if (inner === '' || inner.startsWith('data:') || inner.startsWith('#')) continue
        const target = new URL(inner, url)
        if (target.origin !== pageUrl.origin) {
          if (!FONTS.has(target.hostname)) problems.push(`${url.pathname} names ${target.href}, which is neither this origin nor Google's fonts`)
          continue
        }
        const file = await get(target)
        if (file.status !== 200) problems.push(`${url.pathname} names ${target.pathname}, which answered ${String(file.status)}`)
      }
    }
  }
  return problems
}
