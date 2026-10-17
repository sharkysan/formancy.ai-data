import { describe, expect, test, vi } from 'vitest'
import { KEY_LIFETIME_MS, PREFIX, START_FAILED } from '../../apps/live-demo/dist/worker/pure.mjs'
import { durableObjects } from './cloudflare.mjs'

/**
 * The live demo's Worker as Cloudflare would run it (0070): its own module,
 * dist/worker/cloudflare.mjs, built from src/worker.ts (so `pnpm build`
 * first), its fetch and its DemoServer, over the gate's stand-in for
 * Cloudflare's runtime (cloudflare.mjs) -- here with containers that fail
 * the ways Cloudflare's documentation says a start may, which `pnpm
 * test:live-demo`'s Docker containers never do: start() throwing, as at
 * max_instances, where the documentation says only that the start "will
 * error"; setInactivityTimeout() throwing after a start; and a container
 * that stops before its server answers. No Docker and no image: what is
 * held is what the Durable Object leaves behind when a sign-in is refused.
 *
 * `cloudflare:workers` is the gate's own stand-in, workers.mjs, given here
 * through vi.mock because vitest resolves the Worker's imports itself,
 * where the gate maps the same specifier to the same file with a module
 * hook (hooks.mjs).
 */
vi.mock('cloudflare:workers', () => import('./workers.mjs'))
const { default: worker, DemoServer } = await import('../../apps/live-demo/dist/worker/cloudflare.mjs')

/**
 * A visitor's container as `ctx.container` gives it, which fails as told:
 * `refuse` makes start() throw before anything runs, `timeout` makes
 * setInactivityTimeout() throw, `stops` stops it at its first /health,
 * which otherwise answers 200.
 */
class Container {
  running = false
  starts = 0
  destroyed = 0
  constructor({ refuse = false, timeout = false, stops = false } = {}) {
    this.options = { refuse, timeout, stops }
  }
  start() {
    if (this.running) throw new Error('start() was called while the container is running')
    if (this.options.refuse) throw new Error('the start was refused')
    this.starts += 1
    this.running = true
  }
  async setInactivityTimeout() {
    if (this.options.timeout) throw new Error('the inactivity timeout was refused')
  }
  getTcpPort() {
    return {
      fetch: async () => {
        if (!this.running) throw new Error('the container is not running')
        if (this.options.stops) {
          this.running = false
          throw new Error('Container is not listening to port 4390')
        }
        return new Response('{}', { status: 200 })
      },
    }
  }
  async destroy() {
    this.destroyed += 1
    this.running = false
  }
}

/** A sign-in as a script sends it, Origin set by hand and no cookie, as RELEASING.md's own curl does: each one a new name, so a new Durable Object. */
const signIn = (stand, cookie) =>
  worker.fetch(
    new Request(`https://formancy.ai${PREFIX}/session`, {
      method: 'POST',
      headers: { origin: 'https://formancy.ai', 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify({ persona: 'clara' }),
    }),
    stand.env,
  )

/** What each Durable Object kept: its stored keys, its alarm and its container. */
const left = (stand) => [...stand.objects.values()].map(({ state }) => ({ stored: [...state.stored().keys()], alarm: state.alarm, running: state.container.running }))

describe("a refused sign-in leaves nothing behind (0070's costs)", () => {
  // At the cap Cloudflare's start errors. A Durable Object that stored its
  // key and set its alarm before starting kept both after the refusal, and
  // every scripted sign-in without a cookie names a new object: one more
  // stored key and one more alarm a day later for each, bounded by nothing.
  test('a start that throws stores no key and leaves no alarm, however many are refused', async () => {
    const stand = durableObjects(DemoServer, () => new Container({ refuse: true }))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const answer = await signIn(stand)
      expect(answer.status).toBe(503)
      expect((await answer.json()).message).toBe(START_FAILED)
      expect(answer.headers.get('set-cookie')).toBeNull()
    }
    expect(left(stand)).toEqual(Array.from({ length: 3 }, () => ({ stored: [], alarm: undefined, running: false })))
  })

  // A container that started, and whose inactivity timeout then could not
  // be set, was left running while the visitor was told "nothing was
  // started for you": one of max_instances' places held, with no cookie to
  // reach it by, until Cloudflare stopped it.
  test('a start whose inactivity timeout throws is destroyed, and stores nothing', async () => {
    const containers = []
    const stand = durableObjects(DemoServer, () => {
      containers.push(new Container({ timeout: true }))
      return containers.at(-1)
    })
    const answer = await signIn(stand)
    expect(answer.status).toBe(503)
    expect((await answer.json()).message).toBe(START_FAILED)
    expect(containers.map((container) => ({ starts: container.starts, running: container.running, destroyed: container.destroyed > 0 }))).toEqual([{ starts: 1, running: false, destroyed: true }])
    expect(left(stand)).toEqual([{ stored: [], alarm: undefined, running: false }])
  })

  // A container that stops before its server answers will never answer:
  // refused at once, and nothing of the start kept.
  test('a start whose container stops before it answers stores nothing', async () => {
    const stand = durableObjects(DemoServer, () => new Container({ stops: true }))
    const answer = await signIn(stand)
    expect(answer.status).toBe(503)
    expect(left(stand)).toEqual([{ stored: [], alarm: undefined, running: false }])
  })

  // A refusal after an earlier start whose container has since stopped
  // forgets that start's key too, rather than keeping it for its alarm.
  test("a refused start on a visitor's own instance forgets the key of the start before it", async () => {
    const container = new Container()
    const stand = durableObjects(DemoServer, () => container)
    const first = await signIn(stand)
    expect(first.status).toBe(200)
    const cookie = first.headers.get('set-cookie')?.split(';')[0]
    await container.destroy()
    container.options.refuse = true
    const again = await signIn(stand, cookie)
    expect(again.status).toBe(503)
    expect(left(stand)).toEqual([{ stored: [], alarm: undefined, running: false }])
  })

  // What a refusal must not undo: a start that answers stores its key, for
  // the tokens signed with it, and an alarm a day on, which forgets it.
  test('a start that answers stores its key and sets its alarm a day on', async () => {
    const stand = durableObjects(DemoServer, () => new Container())
    const before = Date.now()
    const answer = await signIn(stand)
    expect(answer.status).toBe(200)
    expect(typeof (await answer.json()).token).toBe('string')
    const [kept] = left(stand)
    expect(kept.stored).toEqual(['key'])
    expect(kept.running).toBe(true)
    expect(kept.alarm).toBeGreaterThanOrEqual(before + KEY_LIFETIME_MS)
    expect(kept.alarm).toBeLessThanOrEqual(Date.now() + KEY_LIFETIME_MS)
  })
})
