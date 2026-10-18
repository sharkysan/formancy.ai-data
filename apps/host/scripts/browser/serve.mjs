// The built page and the plane, on one origin, on a port the system picks:
// the page is same-origin, as a host's is (0024, 0029).
//
// Every file is sent with the Content-Security-Policy deploy/web/nginx.conf
// sends every file under /host/ (0083), from the module nginx.conf's map is
// written from, so what the gate measures is the page under the policy the
// web image serves it with, and a refusal of anything it does is one the
// gate hears.

import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pagePolicy } from '../../../../scripts/web-policies.mjs'

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DIST = join(APP, 'dist')

/** The policy nginx.conf sends with the page and every file under it. */
export const POLICY = pagePolicy('/host/')

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8' }

export function serve(plane) {
  const http = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname.startsWith('/v1/')) {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        const body = Buffer.concat(chunks)
        void plane.server
          .inject({ method: request.method, url: `${url.pathname}${url.search}`, headers: request.headers, ...(body.length > 0 ? { payload: body } : {}) })
          .then((reply) => {
            response.writeHead(reply.statusCode, { 'content-type': String(reply.headers['content-type'] ?? 'application/json') })
            response.end(reply.rawPayload)
          })
      })
      return
    }
    // `normalize` then a prefix check: a path with `..` must not leave dist.
    let file = join(DIST, normalize(decodeURIComponent(url.pathname)))
    if (!file.startsWith(DIST)) return void response.writeHead(403).end()
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return void response.writeHead(404, { 'content-type': 'text/plain', 'content-security-policy': POLICY }).end(`no ${url.pathname}`)
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': POLICY })
    createReadStream(file).pipe(response)
  })
  return new Promise((ready) => http.listen(0, '127.0.0.1', () => ready({ http, port: http.address().port })))
}
