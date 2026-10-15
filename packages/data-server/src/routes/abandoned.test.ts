import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test } from 'vitest'
import { abandonment } from './abandoned.js'

/*
 * How the server learns that the browser gave up on a lookup (0061), over
 * real loopback HTTP and Fastify, with no database: what is under test is
 * which of Node's and Fastify's events say "the client left before the
 * answer", and which only look as if they do. Measured on Fastify 5.12.5,
 * Node 24 and 22, on 2026-10-14: the response's `close` before it finished,
 * and the socket's `close`, do; the request's `close` fires as soon as the
 * body is read, `aborted` never fires, and `onRequestAbort` never runs once
 * the body was read (audit.ts says the same).
 */

interface Seen {
  signal: AbortSignal
  /** `close` listeners on the request's socket while the route ran. */
  listeners: number
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/**
 * A server whose one route takes an abandonment, waits until it is aborted
 * or `answerAfter` passes, settles it and answers. Each request's signal is
 * handed to the test as the route starts.
 */
async function serve(answerAfter: number): Promise<{ port: number; started: () => Promise<Seen> }> {
  const queue: Seen[] = []
  const takers: Array<(seen: Seen) => void> = []
  app = Fastify()
  app.post('/slow', async (request, reply) => {
    const abandoned = abandonment(request, reply)
    const seen = { signal: abandoned.signal, listeners: request.raw.socket.listenerCount('close') }
    const taker = takers.shift()
    if (taker === undefined) queue.push(seen)
    else taker(seen)
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, answerAfter)
        abandoned.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      return { answered: true }
    } finally {
      abandoned.settle()
    }
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as AddressInfo).port
  return {
    port,
    started: () => {
      const ready = queue.shift()
      return ready === undefined ? new Promise((resolve) => takers.push(resolve)) : Promise.resolve(ready)
    },
  }
}

/** `signal` aborted, or a rejection naming it: a signal that never aborts fails here, not at the suite's timeout. */
function aborted(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => reject(new Error(`the route's signal did not abort within ${String(ms)} ms`)), ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

const body = JSON.stringify({ operation: 'create', search: 'Muster' })

describe('abandonment', () => {
  // The renderers abort a superseded search's fetch (formancy 0.5.0). If the
  // server never noticed, the database would finish every scan it started for
  // nobody: what 0061 removes. And the reason is an AbortError, which the
  // route tells apart from a database's failure by identity.
  test("aborts the route's signal with an AbortError when the client's fetch aborts", async () => {
    const { port, started } = await serve(10_000)
    const controller = new AbortController()
    const sent = fetch(`http://127.0.0.1:${String(port)}/slow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: controller.signal })
    const seen = await started()
    controller.abort()
    await expect(sent).rejects.toThrow()
    await aborted(seen.signal, 2_000)
    expect(seen.signal.reason).toBeInstanceOf(DOMException)
    expect((seen.signal.reason as DOMException).name).toBe('AbortError')
  })

  // The request's own `close` fires once its body is read, while the route
  // is still working: listening there would abort every lookup, and every
  // search would be refused. A request answered normally, after its body was
  // read and while the connection stays open, must never abort -- nor once
  // the answer is written and the response closes.
  test('never aborts for a request that is answered', async () => {
    const { port, started } = await serve(100)
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    try {
      const answered = post(port, agent)
      const seen = await started()
      expect(await answered).toBe('{"answered":true}')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(seen.signal.aborted).toBe(false)
    } finally {
      agent.destroy()
    }
  })

  // A keep-alive connection carries request after request. A listener left
  // on its socket per request would grow without bound -- Node warns at 11 --
  // and every one of them would fire, late, when the connection finally
  // closes. Settled, the socket holds the same listeners on the twentieth
  // request as on the first.
  test('leaves no listener on a keep-alive socket after twenty requests', async () => {
    const { port, started } = await serve(0)
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    try {
      const counts: number[] = []
      for (let i = 0; i < 20; i += 1) {
        const answered = post(port, agent)
        counts.push((await started()).listeners)
        await answered
      }
      expect(new Set(counts.slice(1)).size).toBe(1)
      expect(counts[19]).toBe(counts[1])
    } finally {
      agent.destroy()
    }
  })

  // A request pipelined behind another has no socket of its own for its
  // response until the answer before it is written. On Node 22, which CI
  // runs, that response never emits `close` when the connection goes; on
  // Node 24 it does (both probed 2026-10-14 with node:http alone). Only the
  // socket says so on both; a route listening to the response alone would,
  // on Node 22, let the second lookup run to its end for nobody, and this
  // case fails there without the socket's listener.
  test('aborts both routes of two pipelined requests when the connection goes', async () => {
    const { port, started } = await serve(10_000)
    const socket = net.connect(port, '127.0.0.1')
    socket.on('error', () => {})
    const one = `POST /slow HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: ${String(Buffer.byteLength(body))}\r\n\r\n${body}`
    socket.write(one + one)
    const first = await started()
    const second = await started()
    socket.destroy()
    await Promise.all([aborted(first.signal, 2_000), aborted(second.signal, 2_000)])
  })
})

/** One POST on `agent`, its body as text. */
function post(port: number, agent: http.Agent): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = http.request({ port, host: '127.0.0.1', method: 'POST', path: '/slow', agent, headers: { 'content-type': 'application/json' } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    request.on('error', reject)
    request.end(body)
  })
}
