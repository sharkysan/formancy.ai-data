// `doors-check`: what the operator's live hostnames answer, from outside
// (0037).
//
//   docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm doors-check --admin formancy.example.com --team example-team [--app app.example.com]
//
// Nothing in CI can reach an operator's Cloudflare account, so what the
// account holds -- the Access application, Always Use HTTPS, the zone's
// rules -- is checked only here, by what each door answers to a request
// that carries no token and no cookie: the administrator's door answers
// with Access's login redirect, whatever the path; the runtime door brings
// each runtime route to the data server and nothing else to a route or a
// file; and plain HTTP is redirected to the same place over HTTPS. It sends
// a handful of requests per door, prints one line each and the count, and
// exits 1 when any answer is not the one expected, or when there is none.
// What a failure can mean beyond a wrong setting -- a Cloudflare behaviour
// nobody has measured -- docs/deploy/cloudflare.md's section 7 lists.
//
// Its arguments are hostnames and the team's name: never a URL, a path or a
// credential. Every request is sent as written, with Node's http client --
// fetch would resolve `..` and `%2E%2E` before sending -- follows no
// redirect and asks for JSON, which is what data-client asks for.
//
// The verdicts are pure and held by scripts/cloudflare/check.test.mjs
// against answers derived from the built server and deploy/web/nginx.conf.
// Node's built-ins only: it runs in the tools image with nothing installed.

import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { parseInputs } from './ingress.mjs'

/**
 * Four of the paths cloudflared 2026.10.0 matched to the runtime rule while
 * the router ran an administrator's route for them (0037, C6), with the
 * method of that route, and one it matched there while nginx, on the web
 * front's origin, read it as the studio's page. On the runtime door each
 * must reach no route and no file. check.test.mjs holds that each is a path
 * the CI gate sends through cloudflared, the built server and nginx.conf.
 */
export const C6 = [
  { method: 'POST', path: '/v1/connections/..%2Fforms/test' },
  { method: 'GET', path: '/v1/forms/x%2F../versions' },
  { method: 'GET', path: '/v1/forms/a/versions/..%2F..%2Fb' },
  { method: 'GET', path: '/v1/forms/a/versions/..%5C..%5Cb' },
  { method: 'GET', path: '/studio/..%5Cv1%5Cforms%5CZ/%2E%2E/index.html' },
]

/** What each verdict says when it passes: the line the operator reads, and the generated block of the guide. */
const MEANS = {
  access: 'Access answered first',
  https: 'redirected to HTTPS',
  server: 'reached the data server, which asked for a token',
  outside: 'reached no route and no file',
}

/**
 * Every request the check sends, in order, for `inputs` (`{ admin, team,
 * app? }`): `[{ method, scheme, host, path, kind, why }]`.
 */
export function expectations(doors, inputs) {
  const found = []
  const add = (entry) => found.push(entry)
  const pages = ['/studio/', '/host/']
  for (const path of pages) add({ method: 'GET', scheme: 'https', host: inputs.admin, path, kind: 'access' })
  for (const route of doors.routes) add({ method: route.method, scheme: 'https', host: inputs.admin, path: route.sample, kind: 'access' })
  add({ method: 'GET', scheme: 'http', host: inputs.admin, path: '/studio/', kind: 'https' })
  if (inputs.app !== undefined) {
    for (const route of doors.routes) {
      add({ method: route.method, scheme: 'https', host: inputs.app, path: route.sample, kind: route.plane === 'runtime' ? 'server' : 'outside' })
    }
    for (const path of pages) add({ method: 'GET', scheme: 'https', host: inputs.app, path, kind: 'outside' })
    for (const entry of C6) add({ ...entry, scheme: 'https', host: inputs.app, kind: 'outside' })
    const sample = doors.routes.find((route) => route.plane === 'runtime')
    add({ method: sample.method, scheme: 'http', host: inputs.app, path: sample.sample, kind: 'https' })
  }
  return found
}

const header = (response, name) => {
  const value = response.headers?.[name]
  return Array.isArray(value) ? value.join(', ') : value
}

function json(response) {
  try {
    const parsed = JSON.parse(response.body ?? '')
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The headers deploy/web/nginx.conf adds to every answer, its own and the server's: what says a request reached the web front. */
export const WEB_FRONT = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }

const throughWebFront = (response) => Object.entries(WEB_FRONT).every(([name, value]) => header(response, name) === value)

/** The data server's answer, through the web front: nginx's headers, the server's no-store, and its JSON with a code or a status. */
export function fromServer(response) {
  const body = json(response)
  return throughWebFront(response) && header(response, 'cache-control') === 'no-store' && (typeof body?.code === 'string' || typeof body?.status === 'string')
}

/**
 * Whether `response` (`{ status, headers, body }`, headers in lower case)
 * is what `expectation` wants, and, when it is not, what it was instead.
 *
 * - access: exactly a 302 to the team's Access login. Anything else -- a
 *   page, the server's 401, a block, another redirect -- is the door
 *   answering without Access.
 * - https: a 301 or 308 to exactly the same host and path over HTTPS.
 * - server: the data server's 401 for a missing token, through the web front.
 * - outside: an answer that is not the web front's, the data server's 400
 *   path-not-plain, which it gives before any route's work, or nginx's own
 *   404, which the runtime door's server in nginx.conf gives for every path
 *   outside /v1/forms/ and which serves no file. A host application's own
 *   page passes; the studio's would not.
 *
 * No answer at all -- a DNS name that does not resolve, a TLS failure, a
 * refused connection, a timeout (`status` 0, `error` its reason) -- says
 * nothing of a door, and fails every verdict as just that.
 */
export function verdict(expectation, response, inputs) {
  const location = header(response, 'location') ?? ''
  const status = response.status
  if (status === 0) return { pass: false, saw: `no answer (${String(response.error ?? 'unknown')})` }
  switch (expectation.kind) {
    case 'access': {
      if (status === 302 && location.startsWith(`https://${inputs.team}.cloudflareaccess.com/cdn-cgi/access/login/`)) return { pass: true }
      return { pass: false, saw: `answered ${String(status)}${location === '' ? '' : ` to ${location}`} without Access` }
    }
    case 'https': {
      if ((status === 301 || status === 308) && location === `https://${expectation.host}${expectation.path}`) return { pass: true }
      return { pass: false, saw: `answered ${String(status)}${location === '' ? '' : ` to ${location}`}, not a redirect to https://${expectation.host}${expectation.path}` }
    }
    case 'server': {
      const body = json(response)
      if (status === 401 && fromServer(response) && body?.code === 'unauthenticated' && header(response, 'www-authenticate') === 'Bearer') return { pass: true }
      return { pass: false, saw: `answered ${String(status)}${fromServer(response) ? ` ${String(body?.code)}` : ', not as the data server through the web front'}` }
    }
    case 'outside': {
      if (!throughWebFront(response)) return { pass: true }
      if (status === 400 && fromServer(response) && json(response)?.code === 'path-not-plain') return { pass: true }
      if (status === 404 && json(response) === undefined) return { pass: true }
      return { pass: false, saw: `reached the web front and answered ${String(status)}${fromServer(response) ? ` ${String(json(response)?.code ?? json(response)?.status)}` : ''}` }
    }
  }
  throw new Error(`no verdict for ${String(expectation.kind)}`)
}

/** One line per request, then the count: the check's whole output, and the guide's generated block when every line passes. */
export function render(results, inputs) {
  const doors = [`${inputs.admin} (administrator)`, ...(inputs.app === undefined ? [] : [`${inputs.app} (runtime)`])]
  const failed = results.filter((result) => !result.pass).length
  return [
    `doors-check: ${doors.join(', ')}, team ${inputs.team}`,
    ...results.map(({ expectation: entry, pass, saw }) => `${pass ? 'pass' : 'FAIL'}  ${entry.method} ${entry.scheme}://${entry.host}${entry.path}  ${pass ? MEANS[entry.kind] : saw}`),
    `${String(results.length)} requests, ${String(results.length - failed)} as expected, ${String(failed)} not.`,
  ].join('\n')
}

/** Why a request got no answer, from Node's error: its code, such as ENOTFOUND or ECONNREFUSED, or `timeout`. */
const reasonOf = (error) => (error?.code === 'TIMEOUT' ? 'timeout' : String(error?.code ?? error?.message ?? 'unknown'))

/** One request, sent as written: no redirect followed, no token, no cookie, JSON asked for. No answer is status 0, with its reason. */
function send(entry) {
  return new Promise((resolve) => {
    const request = (entry.scheme === 'https' ? httpsRequest : httpRequest)(
      { host: entry.host, path: entry.path, method: entry.method, headers: { accept: 'application/json', 'content-length': '0' }, timeout: 20_000 },
      (incoming) => {
        let body = ''
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk) => {
          if (body.length < 65_536) body += chunk
        })
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }))
        incoming.on('error', (error) => resolve({ status: 0, headers: {}, body: '', error: reasonOf(error) }))
      },
    )
    request.on('timeout', () => request.destroy(Object.assign(new Error('no answer within 20 seconds'), { code: 'TIMEOUT' })))
    request.on('error', (error) => resolve({ status: 0, headers: {}, body: '', error: reasonOf(error) }))
    request.end()
  })
}

async function main(argv) {
  const parsed = parseInputs(argv, 'check')
  if (!parsed.ok) {
    console.error(parsed.problems.join('\n'))
    return 1
  }
  const doors = JSON.parse(readFileSync(new URL('./doors.json', import.meta.url), 'utf8'))
  const results = []
  for (const expectation of expectations(doors, parsed.inputs)) {
    const response = await send(expectation)
    results.push({ expectation, ...verdict(expectation, response, parsed.inputs) })
  }
  console.log(render(results, parsed.inputs))
  return results.every((result) => result.pass) ? 0 : 1
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('deploy/cloudflare/check.mjs')) {
  process.exitCode = await main(process.argv.slice(2))
}
