// The runtime door as it is deployed, for `pnpm test:cloudflare` (0037):
// deploy/web/nginx.conf in the nginx image the web front is built from, in
// front of the built data server, each in a container of the gate's own on a
// network of the gate's own, so that every path cloudflared sends to the
// runtime door can be sent on through the web front exactly as the tunnel
// would send it. Step 5 of scripts/cloudflare.mjs sent them straight to the
// server, and so never saw what nginx answers itself: a path nginx resolves
// into /studio/ is answered from the studio's files and never reaches the
// server's refusal.
//
// The apps are not built here. Their locations hold stand-in files, one at
// each place a climb out of a location lands (ingress.mjs's STATIC_FILES),
// each saying what it is, so an answer that carries one is a file nginx
// served. The server is the checkout's own build, from the repository
// mounted read-only, with both planes, a store in the container, a verifier
// that accepts the token `admin` as an administrator's, and every token it
// is asked about and every audit event it emits printed as a line of JSON:
// what a route's work having begun looks like from outside.

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { STATIC_FILES } from '../../deploy/cloudflare/ingress.mjs'

/** What every stand-in file says, so that a served one is recognised whatever its path. */
export const STAND_IN = 'formancy-data cloudflare gate: a stand-in file of the web front'

/** Where nginx.conf's locations find their files, in the web front's image (deploy/web/Dockerfile). */
const SHARE = '/usr/share/formancy-data'

const SERVER = `
import { mkdtempSync } from 'node:fs'
const server = await import('/repo/packages/data-server/dist/index.mjs')
const say = (line) => process.stdout.write(JSON.stringify(line) + '\\n')
const store = server.createFileConfigurationStore(mkdtempSync('/tmp/formancy-data-store-'))
const registry = server.createConnectionRegistry([], {})
const audit = { sink: (event) => say({ event: { plane: event.plane, operation: event.operation, outcome: event.outcome, status: event.status } }) }
const app = await server.createDataServer({
  verifyIdentity: async (token) => {
    say({ asked: true })
    return token === 'admin' ? { ok: true, identity: { actor: { id: 'gate', roles: ['data-admin'] }, attributes: {} } } : { ok: false, reason: 'no' }
  },
  admin: { registry, store, adminRoles: ['data-admin'], audit },
  runtime: { registry, store, audit },
})
await app.listen({ port: 4390, host: '0.0.0.0' })
say({ listening: 4390 })
`

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 })
  if (!allowFailure && result.status !== 0) throw new Error(`docker ${args.slice(0, 2).join(' ')} failed: ${(result.stderr ?? '').trim()}`)
  return result
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The lines of JSON a container printed, each parsed; any other line is left out. */
function jsonLines(name) {
  const result = docker(['logs', name], { allowFailure: true })
  return `${result.stdout ?? ''}`.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

/**
 * The stand-in files, under a directory nginx's user can read: for each
 * location prefix, the files STATIC_FILES names, below the directory the
 * location's alias is in the web front's image.
 */
function standIns(statics) {
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-cf-web-'))
  chmodSync(root, 0o755)
  for (const location of statics) {
    for (const file of Object.values(STATIC_FILES)) {
      const path = join(root, location, file)
      for (let directory = dirname(path); directory.length > root.length; directory = dirname(directory)) {
        mkdirSync(directory, { recursive: true })
        chmodSync(directory, 0o755)
      }
      writeFileSync(path, `${STAND_IN}: ${location}${file}\n`)
      chmodSync(path, 0o644)
    }
  }
  return root
}

/** The status of `GET path` on loopback `port`, or 0 when nothing answered. */
function status(port, path) {
  return new Promise((resolve) => {
    const outgoing = request({ host: '127.0.0.1', port, path, agent: false, timeout: 2000 }, (incoming) => {
      incoming.resume()
      incoming.on('end', () => resolve(incoming.statusCode ?? 0))
    })
    outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')))
    outgoing.on('error', () => resolve(0))
    outgoing.end()
  })
}

/**
 * Starts the data server and the web front, named after `name`, and waits
 * until a request through nginx reaches the server. `{ port(containerPort),
 * lines(), close() }`: the loopback port nginx's `containerPort` is
 * published on, what the server has printed so far, and the teardown, which
 * removes everything it started.
 */
export async function startWebFront({ name, toolsImage, nginxImage, repo, conf, statics }) {
  const network = `${name}-net`
  const server = `${name}-server`
  const web = `${name}-web`
  const files = standIns(statics)
  const close = () => {
    docker(['rm', '-f', web, server], { allowFailure: true })
    docker(['network', 'rm', network], { allowFailure: true })
    rmSync(files, { recursive: true, force: true })
  }
  try {
    docker(['network', 'create', network])
    docker(['run', '-d', '--name', server, '--network', network, '--network-alias', 'server', '-v', `${repo}:/repo:ro`, '--entrypoint', 'node', toolsImage, '--input-type=module', '-e', SERVER])
    for (let waited = 0; !jsonLines(server).some((line) => line.listening === 4390); waited += 1) {
      if (waited === 60) throw new Error(`the data server did not listen within 30 seconds: ${docker(['logs', server], { allowFailure: true }).stderr.trim()}`)
      await wait(500)
    }
    const mounts = statics.flatMap((location) => ['-v', `${join(files, location)}:${SHARE}${location.replace(/\/$/, '')}:ro`])
    docker(['run', '-d', '--name', web, '--network', network, '-p', '127.0.0.1::8080', '-p', '127.0.0.1::8081', '-v', `${conf}:/etc/nginx/conf.d/default.conf:ro`, ...mounts, nginxImage])
    const port = (target) => {
      const published = /:(\d+)\s*$/m.exec(docker(['port', web, String(target)]).stdout)?.[1]
      if (published === undefined) throw new Error(`the web front publishes no port for ${String(target)}`)
      return Number(published)
    }
    for (let waited = 0; (await status(port(8080), '/health')) !== 200; waited += 1) {
      if (waited === 60) throw new Error(`/health through the web front did not answer 200 within 30 seconds: ${docker(['logs', web], { allowFailure: true }).stderr.trim()}`)
      await wait(500)
    }
    return { port, lines: () => jsonLines(server), close }
  } catch (error) {
    close()
    throw error
  }
}
