// The examples page as formancy.ai serves it (0069), on this machine: the
// built page under the path the demo's Worker is routed at, each file with
// the headers its deploy's `_headers` gives that path. The examples page's
// browser gate measures the page through it, and scripts/demo.test.mjs holds
// what it answers, so the path and the headers every browser check ran under
// are the deploy's and nothing else.
//
// Hand-rolled rather than `vite preview`, as upstream's gate is: what is
// checked is what a host serves.

import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { demoBase, readDemoConfig } from './demo.mjs'
import { headerRules, headersFile, headersFor, parseHeadersFile } from './demo-headers.mjs'

/**
 * The type each file is sent with before the headers have their say. A
 * `.txt` is bare `text/plain`, as Workers static assets sent the report's
 * THIRD-PARTY-NOTICES.txt when measured on 2026-10-16: a type of the gate's
 * own with a charset would hide a deploy whose `_headers` gave the notices
 * none.
 */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  // Each face's fallback (0072): no browser the gate runs asks for one, and
  // one that did would be sent it as Cloudflare would, not as octets.
  '.woff': 'font/woff',
  '.txt': 'text/plain',
}

/**
 * The built page in `directory` over HTTP, on a port the operating system
 * picks: under the demo's path, each file with the headers the deploy's
 * `_headers` gives its path, which override its type, as Cloudflare's
 * documentation says they do, and a file that is not there a 404 with the
 * same headers; the path without its slash sent to it, as the Worker's
 * `auto-trailing-slash` sends it, with none of them; and nothing outside it,
 * which formancy.ai answers from its own site, with none of them either.
 * What the redirect and a 404 carry is what formancy.ai answered on
 * 2026-10-16, read with curl: `/data/examples/nope.js` a 404 with the
 * policy, Permissions-Policy, Referrer-Policy and nosniff, `/data/examples`
 * a 307 to `/data/examples/` with no header of the file's, and `/data` the
 * site's 404. A missing file under `assets/`, which the rules give a year's
 * cache too, was not read, and nothing reads any of it again.
 * Resolves to the server, its port and the path, `/data/examples/`.
 */
export function serveDemo(directory) {
  const base = demoBase(readDemoConfig())
  const rules = parseHeadersFile(headersFile(headerRules(base)))
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === base.slice(0, -1)) {
      response.writeHead(307, { location: base }).end()
      return
    }
    if (!url.pathname.startsWith(base)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end(`no ${url.pathname}: the demo is ${base}`)
      return
    }
    // `normalize` then a prefix check: a path with `..` in it must not leave
    // the directory, even on a server only this machine talks to.
    let file = join(directory, normalize(decodeURIComponent(url.pathname.slice(base.length))))
    if (!file.startsWith(directory)) {
      response.writeHead(403).end()
      return
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    const found = existsSync(file)
    const headers = { 'content-type': found ? (TYPES[extname(file)] ?? 'application/octet-stream') : 'text/plain' }
    for (const [name, value] of Object.entries(headersFor(rules, url.pathname))) headers[name.toLowerCase()] = value
    if (!found) {
      response.writeHead(404, headers).end(`no ${url.pathname}`)
      return
    }
    response.writeHead(200, headers)
    createReadStream(file).pipe(response)
  })
  return new Promise((ready) => {
    server.listen(0, '127.0.0.1', () => ready({ server, port: server.address().port, base }))
  })
}
