// The pure checks of `pnpm test:cloudflare` (0037): what Compose resolves
// deploy/cloudflare/compose.yaml to, and what the Cloudflare guide's commands
// name, each as sentences that never quote a value. scripts/cloudflare.mjs
// runs them on what Compose and the guide say; gate.test.mjs holds each to a
// case without Docker.

import { extractSteps } from '../getting-started/steps.mjs'

export const OVERLAY = 'deploy/cloudflare/compose.yaml'
export const DOCKERFILE = 'deploy/cloudflare/Dockerfile'
export const FILES = ['-f', 'compose.yaml', '-f', OVERLAY]
/** What every command of the guide opens with. */
export const PREFIX = `docker compose ${FILES.join(' ')} `
export const TUNNEL_VOLUME = 'formancy-data-tunnel'
const PINNED = /^cloudflare\/cloudflared:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/
const DIGEST = /@sha256:[0-9a-f]{64}$/

/** A value with its keys sorted, so two resolutions compare by content and not by Compose's key order. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

/** The network the web front and cloudflared share, and nothing else (compose.yaml). */
export const EDGE = 'edge'

/** The networks a resolved service joins: Compose's map or a list, and compose's default network when it names none and has no network_mode. */
function networksOf(service) {
  if (service.network_mode !== undefined) return []
  if (service.networks === undefined) return ['default']
  return (Array.isArray(service.networks) ? service.networks : Object.keys(service.networks)).map(String).sort()
}

/** The value after `flag` in a command list, or the part after `flag=`; undefined when absent. */
function flagValue(command, flag) {
  const at = command.indexOf(flag)
  if (at !== -1) return command[at + 1]
  return command.find((part) => part.startsWith(`${flag}=`))?.slice(flag.length + 1)
}

/**
 * What is wrong with the resolved configuration of both files (`config`),
 * against compose.yaml's alone (`base`) and the tools' Dockerfile
 * (`dockerfile`, its text):
 *
 * - the overlay changes a service of compose.yaml, so a command naming one
 *   file would recreate it;
 * - cloudflared publishes a port, runs an image not pinned by tag and
 *   digest, or one the tools' Dockerfile does not copy its binary from;
 * - its command lacks the generated configuration or `run`, takes a token,
 *   logs below info, serves metrics past loopback, or leaves the management
 *   service's diagnostics on;
 * - a TUNNEL_* setting on any overlay service, a secret in the environment;
 * - the tunnel's volume mounted by any service but the three that need it,
 *   or writable by cloudflared;
 * - an overlay service neither built here nor pinned by digest;
 * - the tools on a network other than the one each needs, doors-check as
 *   root or with a volume, or setup's HOME not on a tmpfs, where the login
 *   lives.
 */
export function cloudflareProblems(config, base, dockerfile) {
  const problems = []
  const services = config.services ?? {}
  for (const [name, service] of Object.entries(base.services ?? {})) {
    if (!same(service, services[name])) problems.push(`${OVERLAY} changes compose.yaml's ${name}, so a command naming compose.yaml alone would recreate it`)
  }
  const overlay = Object.fromEntries(Object.entries(services).filter(([name]) => base.services?.[name] === undefined))
  const cloudflared = overlay.cloudflared
  if (cloudflared === undefined) return [...problems, `${OVERLAY} has no cloudflared service`]

  if ((cloudflared.ports ?? []).length > 0) problems.push('cloudflared publishes a port; the tunnel is outbound only')
  const image = String(cloudflared.image ?? '')
  if (!PINNED.test(image)) problems.push(`cloudflared's image is not cloudflare/cloudflared at a release tag and a digest`)
  const from = /^FROM\s+(\S+)\s+AS\s+cloudflared\s*$/im.exec(dockerfile)?.[1]
  if (from !== image) problems.push(`${DOCKERFILE} copies cloudflared from ${String(from)}, not from the image the cloudflared service runs, so the tools would check the configuration with another binary`)

  const command = (cloudflared.command ?? []).map(String)
  if (flagValue(command, '--config') !== '/etc/formancy-cloudflare/config.yml') problems.push('cloudflared does not run the configuration setup writes, /etc/formancy-cloudflare/config.yml')
  if (command.at(-1) !== 'run') problems.push('cloudflared’s command does not end with run')
  for (const flag of ['--token', '--token-file', '--credentials-contents']) {
    if (command.some((part) => part === flag || part.startsWith(`${flag}=`))) problems.push(`cloudflared is given ${flag}, a secret on its command line`)
  }
  if (!['info', 'warn', 'error', 'fatal'].includes(String(flagValue(command, '--loglevel')))) problems.push('cloudflared logs below info, or does not say: debug writes every request header, host tokens included')
  if (!String(flagValue(command, '--metrics') ?? '').startsWith('127.0.0.1:')) problems.push('cloudflared serves its metrics past loopback, or does not say where: the default is every interface')
  if (!command.includes('--management-diagnostics=false')) problems.push('cloudflared leaves the management service’s diagnostics on, which serve pprof and metrics')

  for (const [name, service] of Object.entries(overlay)) {
    for (const setting of Object.keys(service.environment ?? {})) {
      if (/^TUNNEL_/i.test(setting)) problems.push(`${name} sets ${setting}, which cloudflared reads as configuration, a token among it`)
    }
    if (service.build === undefined && !DIGEST.test(String(service.image ?? ''))) problems.push(`${name} is neither built from this checkout nor pinned by digest`)
    if ((service.ports ?? []).length > 0 && name !== 'cloudflared') problems.push(`${name} publishes a port`)
    for (const mount of service.volumes ?? []) {
      if (mount.type === 'volume' && (mount.source === undefined || mount.source === '')) problems.push(`${name} mounts an anonymous volume at ${mount.target}, which no down removes`)
    }
  }
  for (const [name, service] of Object.entries(services)) {
    const mounts = (service.volumes ?? []).filter((mount) => mount.type === 'volume' && mount.source === TUNNEL_VOLUME)
    if (mounts.length === 0) continue
    if (!['cloudflared', 'tunnel-setup', 'tunnel-config'].includes(name)) problems.push(`${name} mounts the tunnel's volume, which holds its credentials`)
    if (name === 'cloudflared' && mounts.some((mount) => mount.read_only !== true)) problems.push('cloudflared can write the tunnel’s volume; it mounts it read-only')
  }
  // cloudflared reaches whatever its container reaches, for whoever changes
  // its ingress or routes a private network to the tunnel: on `edge` alone,
  // the web front and nothing else of the stack.
  const onEdge = Object.entries(services).filter(([, service]) => networksOf(service).includes(EDGE)).map(([name]) => name)
  const cloudflaredNetworks = networksOf(cloudflared)
  if (cloudflaredNetworks.length !== 1 || cloudflaredNetworks[0] !== EDGE) problems.push(`cloudflared is on ${cloudflaredNetworks.join(', ') || 'no network'}, not on ${EDGE} alone, so a changed ingress or a private route would reach the server past nginx and the databases`)
  for (const name of onEdge.filter((entry) => !['web', 'cloudflared'].includes(entry))) problems.push(`${name} joins ${EDGE}, beside cloudflared, which only the web front may`)
  if (!onEdge.includes('web')) problems.push(`web is not on ${EDGE}, so cloudflared cannot reach it`)
  const network = { 'tunnel-setup': 'bridge', 'tunnel-config': 'none', 'doors-check': 'bridge' }
  for (const [name, mode] of Object.entries(network)) {
    if (overlay[name] === undefined) problems.push(`${OVERLAY} has no ${name} service`)
    else if (overlay[name].network_mode !== mode) problems.push(`${name} is on ${String(overlay[name].network_mode ?? 'compose’s network')}, not ${mode}`)
  }
  const check = overlay['doors-check']
  if (check !== undefined) {
    if (['', '0', 'root', '0:0', 'root:root'].includes(String(check.user ?? ''))) problems.push('doors-check runs as root; it reads three files and sends requests')
    if ((check.volumes ?? []).some((mount) => mount.type !== 'bind')) problems.push('doors-check mounts a volume; it is given nothing but the scripts and doors.json')
  }
  const setup = overlay['tunnel-setup']
  if (setup !== undefined) {
    const home = setup.environment?.HOME
    if (home === undefined || !(setup.tmpfs ?? []).includes(home)) problems.push('tunnel-setup’s HOME is not a tmpfs, so the login’s cert.pem would be written somewhere that outlives the container')
  }
  return problems
}

/**
 * Each image's declared VOLUMEs that its service mounts nothing over: Docker
 * makes an anonymous volume there for every container, which no `down`
 * removes (0032). `images` maps an image to `docker image inspect`'s
 * `.Config.Volumes`.
 */
export function imageVolumeProblems(config, base, images) {
  const problems = []
  for (const [name, service] of Object.entries(config.services ?? {})) {
    if (base.services?.[name] !== undefined) continue
    const covered = new Set([...(service.volumes ?? []).map((mount) => mount.target), ...(service.tmpfs ?? [])])
    for (const path of Object.keys(images[service.image] ?? {})) {
      if (!covered.has(path)) problems.push(`${name}'s image declares a volume at ${path} that the service mounts nothing over`)
    }
  }
  return problems
}

export const NGINX_CONF = 'deploy/web/nginx.conf'
export const WEB_DOCKERFILE = 'deploy/web/Dockerfile'

/**
 * The prefixes of the locations in `conf` (nginx.conf's text) that serve
 * files, by `alias` or `root`: where a path nginx resolves differently from
 * cloudflared could find a file. Read from the configuration, so a location
 * added there is climbed out of without anybody listing it here.
 */
export function staticLocations(conf) {
  return [...conf.matchAll(/^\s*location\s+(\/\S*)\s*\{([^}]*)\}/gm)].filter(([, , body]) => /^\s*(alias|root)\s/m.test(body)).map(([, prefix]) => prefix)
}

/** The image the web front's runtime stage is built FROM, in `dockerfile`'s text: the nginx the gate runs nginx.conf in. */
export function webFrontImage(dockerfile) {
  const image = /^FROM\s+(\S+)\s+AS\s+runtime\s*$/im.exec(dockerfile)?.[1]
  if (image === undefined) throw new Error(`${WEB_DOCKERFILE} has no FROM ... AS runtime stage, so the gate cannot tell which nginx serves nginx.conf`)
  return image
}

/** The port of a rule's `http://web:<port>` service. */
export function webPort(service) {
  const port = /^http:\/\/web:(\d+)$/.exec(service)?.[1]
  if (port === undefined) throw new Error(`${service} is not the web front, so the runtime door does not go through nginx`)
  return Number(port)
}

const VALUE_FLAGS = new Set(['--wait-timeout', '--timeout', '-t', '--tail', '--entrypoint', '-e', '--env', '-u', '--user', '-w', '--workdir', '--name'])

/**
 * What is wrong with the guide's commands against the resolved
 * configuration: every ```sh block, read as the getting-started gate reads
 * its guide, names both files first, and only profiles and services that
 * exist; a code span in the prose that is a compose command names both
 * files too. A rename in the overlay that the guide did not follow fails
 * here.
 */
export function guideCommandProblems(markdown, config, document) {
  const problems = []
  const { run } = extractSteps(markdown, { document })
  const services = config.services ?? {}
  const profiles = new Set(Object.values(services).flatMap((service) => service.profiles ?? []))
  for (const { line, command } of run) {
    const where = `${document} line ${String(line)}`
    if (!command.startsWith(PREFIX)) {
      problems.push(`${where}: "${command}" does not open with "${PREFIX.trim()}", and every command for this stack names both files`)
      continue
    }
    const words = command.slice(PREFIX.length).split(' ')
    let index = 0
    for (; index < words.length && words[index].startsWith('-'); index += 2) {
      if (words[index] !== '--profile') problems.push(`${where}: ${words[index]} before the subcommand is not a profile`)
      else if (!profiles.has(words[index + 1])) problems.push(`${where}: no service has the profile ${String(words[index + 1])}`)
    }
    const subcommand = words[index]
    const rest = words.slice(index + 1)
    const named = []
    for (let at = 0; at < rest.length; at += 1) {
      if (rest[at].startsWith('-')) {
        if (VALUE_FLAGS.has(rest[at])) at += 1
        continue
      }
      named.push(rest[at])
      // `run` takes one service; what follows is its command.
      if (subcommand === 'run') break
    }
    for (const name of named) if (services[name] === undefined) problems.push(`${where}: ${name} is no service of either file`)
  }
  const prose = markdown.replaceAll('\r\n', '\n').replace(/^(\s*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2\s*$/gm, '')
  for (const [, span] of prose.matchAll(/`(docker compose [^`]+)`/g)) {
    const command = span.replace(/\s+/g, ' ')
    if (!command.startsWith(PREFIX)) problems.push(`${document}: \`${command}\` in the prose does not name both files`)
  }
  return problems
}
