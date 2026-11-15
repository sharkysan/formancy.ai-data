// The built studio and a plane, on one origin, on a port the system picks:
// the studio speaks only to the server's origin (0024). The origin itself,
// how it hands a request to the plane and the order it closes in, is the
// host page's too: scripts/gate-origin.mjs.
//
// Every file is sent with the Content-Security-Policy deploy/web/nginx.conf
// sends every file under /studio/ (0083), from the module nginx.conf's map is
// written from, so what the gate measures is the page under the policy the
// web image serves it with, and a refusal of anything it does is one the
// gate hears.

import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveOrigin } from '../../../../scripts/gate-origin.mjs'
import { pagePolicy } from '../../../../scripts/web-policies.mjs'

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DIST = join(APP, 'dist')

/** The policy nginx.conf sends with the page and every file under it. */
export const POLICY = pagePolicy('/studio/')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

/** The studio and `plane` on one origin: its port, and `close()`, which closes the origin and then the plane (gate-origin.mjs). */
export function serve(plane) {
  return serveOrigin(plane, (url, response) => {
    // `normalize` then a prefix check: a path with `..` must not leave dist.
    let file = join(DIST, normalize(decodeURIComponent(url.pathname)))
    if (!file.startsWith(DIST)) return void response.writeHead(403).end()
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return void response.writeHead(404, { 'content-type': 'text/plain', 'content-security-policy': POLICY }).end(`no ${url.pathname}`)
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': POLICY })
    createReadStream(file).pipe(response)
  })
}
