/*
 * The live demo's Worker on Cloudflare (0070): its fetch, which is
 * worker/handle.ts with each visitor's Durable Object as their instance,
 * and that Durable Object, DemoServer, which starts the visitor's container
 * with a key of its own, signs their tokens with it, forwards their
 * requests to it, and forgets the key a day after no container runs.
 *
 * The only file that imports `cloudflare:workers`, and the only one this
 * package's suite does not run: wrangler@4.146.0 refused to run a local
 * container on Windows, and in WSL against Docker Desktop the sidecar it
 * reaches containers through failed at its first iptables rule, so the
 * container never answered (measured on 2026-10-16 and 2026-10-17).
 * `pnpm test:live-demo` runs this module, built to
 * dist/worker/cloudflare.mjs, in front of the real image over a stand-in
 * for Cloudflare's runtime written from its documentation
 * (scripts/live-demo-gate/cloudflare.mjs says what it is and is not), and
 * scripts/live-demo-gate/worker.test.mjs, in `pnpm test:repo`, runs it over
 * the same stand-in with containers that fail to start; that workerd and
 * Cloudflare's containers behave as documented is the first deploy's to
 * read (RELEASING.md), as 0069's Cloudflare behaviour was. It is excluded
 * from the suite's coverage for that reason. Everything it decides with --
 * the routes, the cookie, the refusals, the forwarded headers, the key and
 * the deadline -- is in worker/, tested in Node, and type-checked against
 * the Workers runtime's types by tsconfig.worker.json.
 *
 * It uses the Durable Object Container API (`ctx.container`), which
 * Cloudflare's documentation recommends for new applications, rather than
 * the `Container` class of @cloudflare/containers: no runtime package is
 * bundled into the Worker.
 */
import { DurableObject } from 'cloudflare:workers'
import { IDENTITY_SECRET_VARIABLE, SERVER_PORT } from './image/contract.js'
import { mintToken } from './token.js'
import { forwardFailed, notRunning } from './worker/answers.js'
import { handle } from './worker/handle.js'
import { IDLE_MINUTES, KEY_LIFETIME_MS } from './worker/limits.js'
import { claimsFor, personaById } from './worker/session.js'
import type { SignInResult } from './worker/session.js'
import { failedStartLine, newKey, noInstance, startedLine, untilStopped, waitUntilHealthy } from './worker/start.js'
import type { FailedStart } from './worker/start.js'

interface Env {
  DEMO: DurableObjectNamespace<DemoServer>
}

const IDLE_MS = IDLE_MINUTES * 60_000

/** The one value a DemoServer stores: the key its container was last started with. */
const KEY = 'key'

/**
 * One visitor's server: a Durable Object named by their cookie, with the
 * container wrangler.json attaches to this class. Its container runs the
 * image's data server and PostgreSQL, started with a key made for that
 * start alone, so a token from before a restart is refused after it.
 */
export class DemoServer extends DurableObject<Env> {
  /**
   * The start under way, which every sign-in and forward that arrives
   * during it waits for, so two tabs pressing at once start one container
   * with one key. Not blockConcurrencyWhile: a start may take up to
   * START_DEADLINE_MS, 30 s, and a callback that runs past 30 s resets the
   * Durable Object (Cloudflare's DurableObjectState documentation).
   */
  #starting: Promise<string | undefined> | undefined

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // A Durable Object that starts again -- after a deploy, or evicted while
    // its container ran on -- has no inactivity timeout until it sets one,
    // and without one Cloudflare stops the container shortly after the
    // object is inactive (Cloudflare's documentation of
    // setInactivityTimeout, which says to set it here too).
    const container = ctx.container
    if (container?.running === true) {
      void ctx.blockConcurrencyWhile(async () => {
        try {
          await container.setInactivityTimeout(IDLE_MS)
        } catch {
          // The container then stops sooner than IDLE_MINUTES; the visitor
          // signs in again. A throw here would reset this object.
        }
      })
    }
  }

  /** RPC from the Worker: a token for `personaId`, signed with the key the visitor's running server verifies, starting one when none runs. */
  async signIn(personaId: string): Promise<SignInResult> {
    const persona = personaById(personaId)
    if (persona === undefined) return { ok: false }
    const key = await this.#key()
    if (key === undefined) return { ok: false }
    return { ok: true, ...(await mintToken(key, claimsFor(persona))) }
  }

  /** The key the running server verifies with: the stored one while its container runs, or a new start's. */
  #key(): Promise<string | undefined> {
    if (this.#starting !== undefined) return this.#starting
    const container = this.ctx.container
    if (container === undefined) {
      console.error(failedStartLine({ step: 'other', error: 'no container is attached to this Durable Object' }, undefined))
      return Promise.resolve(undefined)
    }
    const held = this.ctx.storage.kv.get<string>(KEY)
    if (container.running && held !== undefined) return Promise.resolve(held)
    this.#starting = this.#startOrForget(container).finally(() => {
      this.#starting = undefined
    })
    return this.#starting
  }

  /**
   * A start, and after one that failed -- whatever threw, or no answer in
   * time -- everything it might have left forgotten, so that a refused
   * sign-in leaves nothing behind.
   */
  async #startOrForget(container: Container): Promise<string | undefined> {
    const made = newKey()
    let key: string | undefined
    try {
      key = await this.#start(container, made)
    } catch (error) {
      key = failed({ step: 'other', error }, made)
    }
    if (key === undefined) await this.#forget(container)
    return key
  }

  /**
   * Starts the container with `key` and waits for its server to answer
   * /health: the key, kept in storage with an alarm a day on only once the
   * server answers, or undefined when the container could not be started,
   * its inactivity timeout could not be set or it did not answer in time,
   * each said in the live log by the step that failed (0086).
   *
   * Cloudflare says a start it had no instance for, and a container that
   * failed, only by rejecting `monitor()`: a start with no instance is
   * started again within the deadline, as Cloudflare's own Container class
   * does, and any other rejection ends the wait with what it said (0087).
   */
  async #start(container: Container, key: string): Promise<string | undefined> {
    // A container running with a key this object no longer holds would
    // refuse every token signed here.
    if (container.running) await container.destroy()
    let refused: unknown
    let restarts = 0
    const launch = (): void => {
      refused = undefined
      container.start({ env: { [IDENTITY_SECRET_VARIABLE]: key }, enableInternet: false })
      container.monitor().then(
        () => {},
        (error: unknown) => {
          refused = error
        },
      )
    }
    try {
      launch()
    } catch (error) {
      return failed({ step: 'start', error }, key)
    }
    try {
      await container.setInactivityTimeout(IDLE_MS)
    } catch (error) {
      return failed({ step: 'inactivity-timeout', error }, key)
    }
    const port = container.getTcpPort(SERVER_PORT)
    const running = untilStopped(() => container.running)
    let failure: unknown
    const wait = await waitUntilHealthy(
      async (remaining) => {
        if (refused !== undefined) {
          if (!noInstance(refused) || container.running) {
            failure = refused
            throw new Error(`monitor() rejected: ${refused instanceof Error ? refused.message : String(refused)}`)
          }
          restarts += 1
          launch()
          throw new Error('Cloudflare had no container instance; started again')
        }
        const answer = await port.fetch('http://container/health', { signal: AbortSignal.timeout(remaining) })
        await answer.body?.cancel()
        // Said, so that a wait that gives up names what /health answered.
        if (answer.status !== 200) throw new Error(`/health answered ${String(answer.status)}`)
        return true
      },
      { alive: () => failure === undefined && running() },
    )
    if (!wait.healthy) return failed({ step: 'health', wait, restarts }, key)
    console.log(startedLine(wait, restarts))
    this.ctx.storage.kv.put(KEY, key)
    await this.ctx.storage.setAlarm(Date.now() + KEY_LIFETIME_MS)
    return key
  }

  /**
   * After a failed start: the container destroyed if it runs, so it keeps
   * none of max_instances' places, and the key and the alarm of any start
   * before it deleted, so this object keeps nothing and wakes for nothing.
   * The alarm is deleted by itself, not left to deleteAll().
   */
  async #forget(container: Container): Promise<void> {
    try {
      if (container.running) await container.destroy()
    } catch {
      // Already stopped.
    }
    try {
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.deleteAll()
    } catch {
      // Storage refused: an alarm left behind deletes the key a day on.
    }
  }

  /**
   * A request the Worker forwards: to the running server once any start
   * under way has finished; the not-running answer when none runs, since
   * only a sign-in starts one; a bare 502 when the forward fails, since it
   * may have reached the server.
   */
  override async fetch(request: Request): Promise<Response> {
    if (this.#starting !== undefined) await this.#starting
    const container = this.ctx.container
    if (container?.running !== true) return notRunning()
    try {
      return await container.getTcpPort(SERVER_PORT).fetch(request)
    } catch {
      return forwardFailed()
    }
  }

  /** A day after the last start: the key is deleted when no container runs, so nothing about a visitor outlives a day. */
  override async alarm(): Promise<void> {
    if (this.ctx.container?.running === true) {
      await this.ctx.storage.setAlarm(Date.now() + KEY_LIFETIME_MS)
      return
    }
    await this.ctx.storage.deleteAll()
  }
}

/** A failed start, said in the Worker's live log, which `wrangler tail` shows and nothing keeps (0086): undefined, the start's outcome. */
function failed(failure: FailedStart, key: string): undefined {
  console.error(failedStartLine(failure, key))
  return undefined
}

export default {
  fetch(request, env) {
    return handle(request, (name) => {
      const stub = env.DEMO.get(env.DEMO.idFromName(name))
      return { signIn: async (persona) => await stub.signIn(persona), fetch: (forwarded) => stub.fetch(forwarded) }
    })
  },
} satisfies ExportedHandler<Env>
