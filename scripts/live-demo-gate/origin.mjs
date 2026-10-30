// formancy.ai/data/demo/ on this machine, for the live demo's gate (0070):
// what Cloudflare does with a request to the demo's routes, as
// apps/live-demo/wrangler.json's `assets` asks it to, read in Cloudflare's
// static-assets documentation (routing, html_handling, not_found_handling,
// run_worker_first) and not measured there: a path run_worker_first names
// goes to the Worker; any other path under the demo is a file of the page
// with the headers its `_headers` gives that path, and a miss goes to the
// Worker, whose 404 carries the Worker's own headers; the path without its
// slash, or an index.html by name, is sent to the directory with a bare 307,
// as formancy.ai/data/examples answered on 2026-10-16.
//
// The Worker is whatever `fetch` the gate gives: the demo's own,
// dist/worker/cloudflare.mjs, over the gate's stand-in for Cloudflare's
// runtime (cloudflare.mjs).

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { headersFor } from '../demo-headers.mjs'

/** A run_worker_first pattern as Cloudflare documents it: a path, `*` matching anything, slashes included. */
function patternOf(glob) {
  if (glob.startsWith('!')) throw new Error(`run_worker_first's ${glob} is negated, which the gate's origin does not model`)
  return new RegExp(
    `^${glob
      .split('*')
      .map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  )
}

/**
 * Where a request for `pathname` goes: `{ kind: 'worker' }`,
 * `{ kind: 'asset', file }` (the file's path as served), `{ kind:
 * 'redirect', location }`, or `{ kind: 'elsewhere' }` for a path outside the
 * demo's routes, which formancy.ai's own site answers. `exists(path)` says
 * whether the page has a file at a served path.
 */
export function routeOf(pathname, { prefix, assets, exists }) {
  if (assets.html_handling !== 'auto-trailing-slash') throw new Error(`html_handling ${String(assets.html_handling)} is not what the gate's origin models`)
  if (assets.not_found_handling !== 'none') throw new Error(`not_found_handling ${String(assets.not_found_handling)} is not what the gate's origin models`)
  const first = (assets.run_worker_first ?? []).map(patternOf)
  if (pathname === prefix) return { kind: 'redirect', location: `${prefix}/` }
  if (!pathname.startsWith(`${prefix}/`)) return { kind: 'elsewhere' }
  if (first.some((pattern) => pattern.test(pathname))) return { kind: 'worker' }
  if (pathname.endsWith('/index.html') && exists(pathname)) return { kind: 'redirect', location: pathname.slice(0, -'index.html'.length) }
  const file = pathname.endsWith('/') ? `${pathname}index.html` : pathname
  return exists(file) ? { kind: 'asset', file } : { kind: 'worker' }
}

/**
 * The type a file is sent with before `_headers` has its say: a `.txt` is
 * bare `text/plain`, as Workers static assets sent one when measured on
 * 2026-10-16 (scripts/demo-serve.mjs says so for the examples page).
 */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain',
}

/** The incoming request as the Request a Worker is given: its own address, every header as sent, and its body streamed. */
function requestOf(incoming) {
  const url = new URL(incoming.url ?? '/', `http://${String(incoming.headers.host)}`)
  const headers = new Headers()
  for (let at = 0; at < incoming.rawHeaders.length; at += 2) headers.append(incoming.rawHeaders[at], incoming.rawHeaders[at + 1])
  const bodied = incoming.method !== 'GET' && incoming.method !== 'HEAD'
  return new Request(url, { method: incoming.method, headers, ...(bodied ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) })
}

/** Writes the Worker's answer, each Set-Cookie on its own line, its body streamed. */
async function send(outgoing, answer) {
  const headers = {}
  for (const [name, value] of answer.headers) if (name !== 'set-cookie') headers[name] = value
  const cookies = answer.headers.getSetCookie()
  if (cookies.length > 0) headers['set-cookie'] = cookies
  outgoing.writeHead(answer.status, headers)
  if (answer.body === null) return void outgoing.end()
  Readable.fromWeb(answer.body).pipe(outgoing)
}

/**
 * The demo's routes on a loopback port the system picks: the page built in
 * `directory` under `prefix`, with `rules` (the deploy's `_headers`, read
 * back), and `worker(request)` for everything run_worker_first names and
 * every miss. A Worker that throws is Cloudflare's 500, which no client of
 * the demo reads as a refusal. Resolves to `{ server, origin }`.
 */
export function serveOrigin({ directory, prefix, assets, rules, worker }) {
  const root = normalize(directory)
  const fileOf = (path) => {
    const file = normalize(join(root, decodeURIComponent(path.slice(prefix.length + 1))))
    return file.startsWith(`${root}${sep}`) && existsSync(file) && statSync(file).isFile() ? file : undefined
  }
  const server = createServer((incoming, outgoing) => {
    const pathname = new URL(incoming.url ?? '/', 'http://origin').pathname
    const decided = routeOf(pathname, { prefix, assets, exists: (path) => fileOf(path) !== undefined })
    if (decided.kind === 'redirect') return void outgoing.writeHead(307, { location: decided.location }).end()
    if (decided.kind === 'elsewhere')
      return void outgoing.writeHead(404, { 'content-type': 'text/plain' }).end(`${pathname} is formancy.ai's own site, not the demo's.`)
    if (decided.kind === 'asset') {
      const headers = { 'content-type': TYPES[extname(decided.file)] ?? 'application/octet-stream' }
      for (const [name, value] of Object.entries(headersFor(rules, pathname))) headers[name.toLowerCase()] = value
      outgoing.writeHead(200, headers)
      if (incoming.method === 'HEAD') return void outgoing.end()
      return void createReadStream(fileOf(decided.file)).pipe(outgoing)
    }
    worker(requestOf(incoming)).then(
      (answer) => send(outgoing, answer),
      () => outgoing.writeHead(500, { 'content-type': 'text/plain' }).end('The Worker threw.'),
    )
  })
  return new Promise((ready) => server.listen(0, '127.0.0.1', () => ready({ server, origin: `http://127.0.0.1:${String(server.address().port)}` })))
}
