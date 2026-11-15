// The origin the studio's and the host page's browser gates serve from:
// the built page and the plane on one origin, on 127.0.0.1 at a port the
// system picks (0024, 0029) -- each request under /v1/ handed to the
// plane's server through `inject`, every other to the app's own files --
// and closed in the one order that leaves the plane nothing to answer.
//
// The plane is a Fastify instance the gates never listen with, so its
// `close()` waits for no request: one handed over before it goes on being
// answered after it, and one handed over after it is refused with
// FST_ERR_REOPENED_CLOSE_SERVER (fastify 5.12.8, `inject` in fastify.js).
// The gates closed their origin with `http.close()`, which drops only idle
// connections, and the plane straight after. The host page's last two
// WebKit runs on main failed so after every check had passed, each on a
// rejection nothing heard, which the gate throws: a request whose body
// ended once the plane's server had closed, refused (run 43697124883,
// 2026-11-15); and postgres.js's fetch of array types, which it never
// awaits, on a connection the database's stop reset (run 43431703107,
// 2026-11-13). The plane ends its pools before that stop, so the
// connection was one only a request still being answered after the
// plane's server had closed could open: the connection registry opens a
// pool again when asked after it has closed, and nothing ends that one.
//
// So `close()` stops taking connections, drops every one a browser holds,
// kept alive or partway through a request, and closes the plane only once
// the plane has answered every request it was handed. A request the plane
// refuses is answered 503, as Fastify answers one that reaches it while it
// closes; the browser's connection may be gone by then, and writing to it
// does nothing.

import { createServer } from 'node:http'

/**
 * Serves `files(url, response)` and `plane.server` on one origin.
 * Resolves with its port and `close(step)`, which closes the origin, then
 * `plane.close(step)`, and names each of its own steps to `step` before it
 * runs, for a gate to say which one a late error came in.
 */
export function serveOrigin(plane, files) {
  // Every request handed to the plane, until it has been answered.
  const answering = new Set()
  const http = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/v1/')) return void files(url, response)
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      const answered = plane.server
        .inject({ method: request.method, url: `${url.pathname}${url.search}`, headers: request.headers, ...(body.length > 0 ? { payload: body } : {}) })
        .then(
          (reply) => {
            response.writeHead(reply.statusCode, { 'content-type': String(reply.headers['content-type'] ?? 'application/json') })
            response.end(reply.rawPayload)
          },
          (refusal) => {
            response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
            response.end(`The plane refused the request: ${refusal instanceof Error ? refusal.message : String(refusal)}`)
          },
        )
      answering.add(answered)
      void answered.finally(() => answering.delete(answered))
    })
  })

  let closed = null
  const close = (step = () => {}) => {
    closed ??= (async () => {
      step('closing the origin, with every connection the browser holds')
      const stopped = new Promise((resolve, reject) => http.close((error) => (error === undefined ? resolve() : reject(error))))
      http.closeAllConnections()
      // Once the server has closed, every connection has, and no request
      // can end on one: what `answering` holds then is all there will be.
      await stopped
      step('waiting for the plane to answer every request it was handed')
      await Promise.allSettled([...answering])
      await plane.close(step)
    })()
    return closed
  }

  return new Promise((ready, fail) => {
    http.once('error', fail)
    http.listen(0, '127.0.0.1', () => ready({ port: http.address().port, close }))
  })
}
