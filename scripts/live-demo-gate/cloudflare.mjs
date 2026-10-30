// Cloudflare's runtime for the live demo's Worker (0070), stood in for on
// one machine, so `pnpm test:live-demo` runs the Worker's own code -- its
// fetch and its DemoServer, dist/worker/cloudflare.mjs, built from
// src/worker.ts -- in front of the real image.
//
// Why a stand-in: `wrangler dev` runs the Worker and its Durable Object in
// workerd and starts the container locally, but its container never
// answered here. On Windows Wrangler 4.146.0 refuses local containers; in
// WSL against Docker Desktop (engine 28.3.3, kernel
// 5.15.167.4-microsoft-standard-WSL2) it built the image and started it,
// and the sidecar it routes the Durable Object's connections through,
// cloudflare/proxy-everything:3cb1195, exited 4 at its first iptables rule
// ("Extension socket revision 0 not supported, missing kernel module?"), so
// every connection to the container was lost and the Worker answered its
// own "could not be started" after 35.2 s (measured 2026-10-16 with a
// prototype and 2026-10-17 with this Worker, config and image).
//
// What the stand-in is, each part written from Cloudflare's documentation
// (cloudflare/cloudflare-docs at 0a7e37ca, read 2026-10-16) and not from
// workerd's behaviour, which nothing here observed:
//
// - the Durable Object namespace: one object per name, kept for the run,
//   its RPC arguments and answers structured clones, as RPC sends them;
// - its state: the synchronous `storage.kv`, `setAlarm`, `deleteAlarm` and
//   `deleteAll`, and `blockConcurrencyWhile`, which here only runs its
//   callback;
// - `ctx.container` (durable-object-container.mdx): `start()` returns before
//   the server is ready and throws when already running; `running` is true
//   from start() until the container stops; `getTcpPort(port).fetch()`
//   fails until something listens; `destroy()` stops it. Behind it, a
//   `docker run` of the image at wrangler.json's instance type's share, the
//   start's `env` passed by name only.
//
// What it does not do: take the network away for `enableInternet: false`
// (recorded, and checked to be what the Worker asks, but a container here
// can reach out); stop a container after its inactivity timeout (recorded;
// the gate stops it as the timeout would); place, schedule or cap
// containers (`max_instances` is not enforced locally on Cloudflare
// either); or run workerd. So this shows the Worker's code doing what it
// should given the runtime its documentation describes, and the image
// answering it; that Cloudflare's runtime is that runtime is the first
// deploy's to read (RELEASING.md).

import { execFile, spawn } from 'node:child_process'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { memoryUsed, publishedPort, runArguments } from './docker.mjs'

const execute = promisify(execFile)

/** One `docker` command's standard output; throws with its standard error when it fails. */
export async function docker(args) {
  const { stdout } = await execute('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  return stdout
}

/** The demo's Worker module, with `cloudflare:workers` the gate's own (hooks.mjs). */
export async function loadWorker(file) {
  register('./hooks.mjs', import.meta.url)
  return import(pathToFileURL(file).href)
}

/**
 * A visitor's container, as `ctx.container` gives it to the Durable
 * Object, on Docker: one `docker run` of `image` per start, named
 * `<name>-<n>`, under `quota`, `port` published on loopback. What the
 * Worker asked of it is kept for the gate to check: each start's variable
 * names and enableInternet, and each inactivity timeout.
 */
export class DockerContainer {
  #image
  #name
  #quota
  #port
  #child
  #exited = Promise.resolve()
  #running = false
  #published
  #log = ''
  /** Each start, in order: `{ name, variables, enableInternet, startedAt, healthyAt }`. */
  starts = []
  /** Each setInactivityTimeout, in milliseconds. */
  inactivityTimeouts = []

  constructor({ image, name, quota, port }) {
    this.#image = image
    this.#name = name
    this.#quota = quota
    this.#port = port
  }

  get running() {
    return this.#running
  }

  /** The current or last start's container name. */
  get name() {
    return this.starts.at(-1)?.name
  }

  /** Everything every start of this container wrote to its output, which is what Cloudflare's logs would hold. */
  get log() {
    return this.#log
  }

  start(options = {}) {
    if (this.#running) throw new Error('start() was called while the container is running')
    const env = options.env ?? {}
    const name = `${this.#name}-${String(this.starts.length + 1)}`
    const start = { name, variables: Object.keys(env).sort(), enableInternet: options.enableInternet, startedAt: Date.now(), healthyAt: undefined }
    this.starts.push(start)
    this.#published = undefined
    // Each variable named, never valued: the CLI takes the values from the
    // environment it is spawned with.
    const args = runArguments({ image: this.#image, name, port: this.#port, quota: this.#quota, variables: start.variables })
    const child = spawn('docker', args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.setEncoding('utf8').on('data', (chunk) => (this.#log += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (this.#log += chunk))
    this.#running = true
    this.#child = child
    this.#exited = new Promise((resolve) =>
      child.on('close', () => {
        if (this.#child === child) this.#running = false
        resolve()
      }),
    )
  }

  async setInactivityTimeout(ms) {
    this.inactivityTimeouts.push(ms)
  }

  /** Settles when the container exits, as Cloudflare's does; a `docker run` never reports no instance. */
  monitor() {
    return this.#exited
  }

  getTcpPort(port) {
    if (port !== this.#port) throw new Error(`the gate publishes the image's port ${String(this.#port)}, not ${String(port)}`)
    return { fetch: (input, init) => this.#fetch(input, init) }
  }

  /** The request, at its path and query, to the container's port; throws while nothing listens there. */
  async #fetch(input, init) {
    if (!this.#running) throw new Error('the container is not running')
    const request = new Request(input, init)
    if (this.#published === undefined) {
      const host = publishedPort(await docker(['port', this.name, `${String(this.#port)}/tcp`]))
      if (host === undefined) throw new Error(`the container's port ${String(this.#port)} is not published yet`)
      this.#published = host
    }
    const url = new URL(request.url)
    const answer = await fetch(`http://127.0.0.1:${String(this.#published)}${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
      signal: request.signal,
      ...(request.body === null ? {} : { body: request.body, duplex: 'half' }),
    })
    const start = this.starts.at(-1)
    if (start.healthyAt === undefined && url.pathname === '/health' && answer.status === 200) start.healthyAt = Date.now()
    return answer
  }

  async destroy() {
    if (!this.#running) return
    await docker(['rm', '--force', '--volumes', this.name]).catch(() => {})
    await this.#exited
  }

  /** The running container's peak memory, from its cgroup, and whether the engine killed it for memory. */
  async memory() {
    const read = (path) => docker(['exec', this.name, 'cat', path]).catch(() => undefined)
    const used = memoryUsed({ v2: await read('/sys/fs/cgroup/memory.peak'), v1: await read('/sys/fs/cgroup/memory/memory.max_usage_in_bytes') })
    const killed = (await docker(['inspect', '--format', '{{.State.OOMKilled}}', this.name])).trim() === 'true'
    return { ...used, killed }
  }

  /**
   * What of the server's code its own user could write (0102): every path
   * under /app it owns or anybody may write, a link passed over since its
   * own mode means nothing, and the entry point it runs when a write to it
   * went through. Empty when it can write none.
   */
  async writableCode() {
    const owned = await docker([
      'exec',
      '--user',
      'node',
      this.name,
      'find',
      '/app',
      '!',
      '-type',
      'l',
      '(',
      '-user',
      'node',
      '-o',
      '-perm',
      '-0002',
      ')',
      '-print',
    ])
    const wrote = await docker(['exec', '--user', 'node', this.name, 'touch', '/app/dist/main.mjs']).then(
      () => true,
      () => false,
    )
    return [...owned.split('\n').filter((line) => line !== ''), ...(wrote ? ['/app/dist/main.mjs, which it wrote'] : [])]
  }

  /**
   * A variable of the server's environment inside the running container,
   * read as the server's own user: root in the container may not read
   * /proc/1/environ (measured in stage 2, 2026-10-16).
   */
  async serverVariable(variable) {
    const environ = await docker(['exec', '--user', 'node', this.name, 'cat', '/proc/1/environ'])
    return environ
      .split('\0')
      .find((entry) => entry.startsWith(`${variable}=`))
      ?.slice(variable.length + 1)
  }
}

/** A Durable Object's state as the demo's DemoServer reaches it. */
function stateFor(container) {
  const kv = new Map()
  const state = {
    container,
    alarm: undefined,
    storage: {
      kv: { get: (key) => kv.get(key), put: (key, value) => void kv.set(key, value), delete: (key) => kv.delete(key) },
      setAlarm: async (at) => {
        state.alarm = at
      },
      deleteAlarm: async () => {
        state.alarm = undefined
      },
      // The stored values alone. Whether Cloudflare's deleteAll() takes an
      // alarm with them was not read for 0070, so here it does not: a test
      // that finds no alarm has seen the Worker delete it with deleteAlarm().
      deleteAll: async () => {
        kv.clear()
      },
    },
    blockConcurrencyWhile: async (callback) => callback(),
    /** What the object stores, for the gate to look at. */
    stored: () => new Map(kv),
  }
  return state
}

/**
 * The Worker's environment: `DEMO`, the namespace of `DemoServer` objects,
 * each made on first use with a container from `containerFor(name)`. Also
 * returns the objects by name, for the gate to look at and to stop.
 */
export function durableObjects(DemoServer, containerFor) {
  const env = {}
  const objects = new Map()
  const objectOf = (name) => {
    let found = objects.get(name)
    if (found === undefined) {
      const state = stateFor(containerFor(name))
      found = { state, server: new DemoServer(state, env) }
      objects.set(name, found)
    }
    return found
  }
  env.DEMO = {
    idFromName: (name) => ({ name, toString: () => name }),
    get: (id) => {
      const { server } = objectOf(id.name)
      return {
        signIn: async (persona) => structuredClone(await server.signIn(structuredClone(persona))),
        fetch: (request) => server.fetch(request),
      }
    },
  }
  return { env, objects }
}
