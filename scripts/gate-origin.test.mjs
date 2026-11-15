import { createRequire } from 'node:module'
import { connect as connectTcp } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { serveOrigin } from './gate-origin.mjs'

/**
 * The origin the studio's and the host page's browser gates serve from
 * (gate-origin.mjs), without a browser: a raw socket stands for each
 * connection a browser holds. The plane is the plane's own Fastify -- the
 * release data-server runs, resolved from its package, as the gates make
 * their planes with it -- because what the origin answers for is what that
 * Fastify does: its `close()` waits for no request handed to it through
 * `inject`, and it refuses one handed to it after.
 */
const fastify = createRequire(new URL('../packages/data-server/package.json', import.meta.url))('fastify')

/**
 * How long a case gives the origin to drop a connection before calling it
 * still open. Measured on 2026-11-15 on an Apple M2 with Node 22.23.4, 50
 * closes of three connections each, kept alive, waiting on the plane and
 * partway through a body: the slowest close took 2.2 ms to drop all three,
 * the median 0.4 ms. A second leaves a loaded CI runner room, and a case
 * still ends well inside Vitest's five seconds when a connection is kept.
 */
const DROP_MS = 1_000

const POST_HELD = 'POST /v1/held HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 2\r\n'

let unheard = []
const hear = (reason) => unheard.push(reason)
let cleanup = []
beforeEach(() => {
  unheard = []
  process.on('unhandledRejection', hear)
})
afterEach(async () => {
  process.off('unhandledRejection', hear)
  await Promise.allSettled(cleanup.reverse().map((step) => step()))
  cleanup = []
})

/** The first rejection nobody heard, or nothing until the case has moved on. */
const firstUnheard = () => new Promise((resolve) => process.once('unhandledRejection', resolve))

/**
 * The plane's Fastify with two routes, one answered at once and one held
 * until the case lets it go, and a `close` that records whether the held
 * one had been answered when it was called.
 */
async function heldPlane() {
  const server = fastify()
  let release = () => {}
  const released = new Promise((resolve) => {
    release = resolve
  })
  let enter = () => {}
  const entered = new Promise((resolve) => {
    enter = resolve
  })
  let answered = false
  server.get('/v1/quick', async () => ({ quick: true }))
  server.post('/v1/held', async () => {
    enter()
    await released
    answered = true
    return { held: true }
  })
  await server.ready()
  const closes = []
  cleanup.push(async () => {
    release()
    await server.close()
  })
  return {
    server,
    entered,
    release,
    closes,
    close: async () => {
      closes.push({ answered })
      await server.close()
    },
  }
}

/** The origin over `plane`, its files answered 404: no case here asks for one. */
async function serve(plane) {
  const origin = await serveOrigin(plane, (url, response) => void response.writeHead(404).end(`no ${url.pathname}`))
  cleanup.push(() => origin.close())
  return origin
}

/** A connection to the origin as a browser holds one, named for what a case says of it. */
async function connect(port, name) {
  const socket = connectTcp({ port, host: '127.0.0.1' })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  cleanup.push(() => socket.destroy())
  let text = ''
  let closed = false
  socket.setEncoding('latin1')
  socket.on('data', (chunk) => {
    text += chunk
  })
  // A connection the origin drops may arrive as a reset: closed either way.
  socket.on('error', () => {})
  const whenClosed = new Promise((resolve) => {
    socket.once('close', () => {
      closed = true
      resolve()
    })
  })
  return {
    name,
    send: (bytes) => socket.write(bytes),
    closed: () => closed,
    whenClosed,
    /** What came back once it matches `pattern`; refused, with what did come, if the connection closes first. */
    until: (pattern) =>
      new Promise((resolve, reject) => {
        const look = () => {
          if (pattern.test(text)) {
            stop()
            resolve(text)
          } else if (closed) {
            stop()
            reject(new Error(`${name} closed after ${JSON.stringify(text)}`))
          }
        }
        const stop = () => {
          socket.off('data', look)
          socket.off('close', look)
        }
        socket.on('data', look)
        socket.on('close', look)
        look()
      }),
  }
}

/** The names of `connections` still open once a drop has had DROP_MS to arrive. */
async function stillOpen(connections) {
  await Promise.race([Promise.all(connections.map((connection) => connection.whenClosed)), delay(DROP_MS)])
  return connections.filter((connection) => !connection.closed()).map((connection) => connection.name)
}

describe('serveOrigin', () => {
  // WebKit sent the host page's origin a request after the gate's last page
  // had closed, whose body ended once the plane's server had closed: Fastify
  // refused the inject, nothing heard the refusal, and the unhandled
  // rejection failed the WebKit leg after every check had passed (run
  // 43697124883, 2026-11-15). Answered, the browser hears the refusal and
  // the process hears nothing.
  test('answers 503 to a request whose body ends after the plane has closed, and leaves no rejection unheard', async () => {
    const plane = await heldPlane()
    const origin = await serve(plane)
    const browser = await connect(origin.port, 'late')
    browser.send(`${POST_HELD}\r\n{`)
    await plane.server.close()
    browser.send('}')
    await Promise.race([browser.until(/\r\n\r\n/), firstUnheard()])
    expect(unheard).toEqual([])
    expect(await browser.until(/\r\n\r\n/)).toMatch(/^HTTP\/1\.1 503 /)
  })

  // `http.close()`, which is how the gates closed their origin, drops only
  // the connections that are idle: one partway through a request, or
  // waiting on the plane's answer, stayed open past the plane's close, and
  // what a browser sent on it reached a closed plane (run 43697124883).
  test('close() drops every connection a browser holds: kept alive after an answer, partway through a body, and waiting on the plane', async () => {
    const plane = await heldPlane()
    const origin = await serve(plane)
    const idle = await connect(origin.port, 'kept alive after an answer')
    idle.send('GET /v1/quick HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
    // The answer is chunked, so it has all come once its last chunk has.
    expect(await idle.until(/\r\n0\r\n\r\n$/)).toMatch(/^HTTP\/1\.1 200 [^]*\{"quick":true\}/)
    const partway = await connect(origin.port, 'partway through a body')
    partway.send(`${POST_HELD}Expect: 100-continue\r\n\r\n`)
    // The origin has read the request's head once it says to go on; the body it is then sent stops short.
    await partway.until(/^HTTP\/1\.1 100 Continue\r\n\r\n$/)
    partway.send('{')
    const waiting = await connect(origin.port, 'waiting on the plane')
    waiting.send(`${POST_HELD}\r\n{}`)
    await plane.entered
    const closing = origin.close()
    expect(await stillOpen([idle, partway, waiting])).toEqual([])
    plane.release()
    await closing
    expect(unheard).toEqual([])
  })

  // Fastify's close() waits for no request handed to it through inject, so
  // a request still being answered after the host page's plane had closed
  // its server could open the connection registry again after it had
  // closed: a pool nothing ends, whose connection the database's stop
  // resets while postgres.js fetches its array types, which it never
  // awaits -- the rejection run 43431703107 (2026-11-13) failed on.
  test('close() closes the plane only once the plane has answered every request it was handed', async () => {
    const plane = await heldPlane()
    const origin = await serve(plane)
    const waiting = await connect(origin.port, 'waiting on the plane')
    waiting.send(`${POST_HELD}\r\n{}`)
    await plane.entered
    const closing = origin.close()
    expect(await Promise.race([closing.then(() => 'closed'), delay(DROP_MS).then(() => 'still waiting')])).toBe('still waiting')
    plane.release()
    await closing
    expect(plane.closes).toEqual([{ answered: true }])
    expect(unheard).toEqual([])
  })
})
