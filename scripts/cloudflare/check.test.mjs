import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { C6, expectations, fromServer, render, verdict, WEB_FRONT } from '../../deploy/cloudflare/check.mjs'
import { hostilePaths } from '../../deploy/cloudflare/ingress.mjs'
import { staticLocations } from './gate.mjs'

/**
 * doors-check's verdicts (0037), against answers of every kind a door can
 * give. The live run is the operator's: CI has no account. So the answers
 * the data server gives through the web front are not typed here but taken
 * from the built server, with the headers deploy/web/nginx.conf adds to
 * every answer; the edge's are fixtures whose provenance each case states.
 * Each verdict fails when its rule is inverted, and passes nothing else.
 *
 * It needs `pnpm build`, as doors.test.mjs does.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const doors = JSON.parse(readFileSync(join(repo, 'deploy', 'cloudflare', 'doors.json'), 'utf8'))
const inputs = { admin: 'formancy.example.com', team: 'example-team', app: 'app.example.com' }
/**
 * fixtures/nginx-404.html is nginx's own 404: what
 * nginxinc/nginx-unprivileged:1.30.5-alpine, the web front's base, answered
 * to GET /nothing with deploy/web/nginx.conf, captured on 2026-10-11 (line
 * ends made LF, as the repository stores text). It carried the three
 * headers nginx.conf adds and no Cache-Control.
 */
const fixture = (name) => readFileSync(join(repo, 'scripts', 'cloudflare', 'fixtures', name), 'utf8')

/** What nginx.conf adds to every answer with `add_header ... always`, a variable's empty value left out as nginx leaves it out. */
function webFrontHeaders() {
  const conf = readFileSync(join(repo, 'deploy', 'web', 'nginx.conf'), 'utf8')
  return Object.fromEntries([...conf.matchAll(/^\s*add_header\s+(\S+)\s+([^$\s][^;]*?)\s+always;$/gm)].map(([, name, value]) => [name.toLowerCase(), value]))
}

const scratch = mkdtempSync(join(tmpdir(), 'formancy-data-check-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const server = await import(pathToFileURL(join(repo, 'packages', 'data-server', 'dist', 'index.mjs')).href)
const store = server.createFileConfigurationStore(scratch)
const registry = server.createConnectionRegistry([], {})
const app = await server.createDataServer({
  verifyIdentity: async () => ({ ok: false, reason: 'no token is valid here' }),
  runtime: { registry, store, audit: { sink: () => {} } },
  admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
})
afterAll(() => app.close())

/** The built server's answer to `method path`, with no token, as it reaches the edge through nginx. */
async function throughWebFront(method, path) {
  const answer = await app.inject({ method, url: path, headers: { accept: 'application/json' } })
  return { status: answer.statusCode, headers: { ...answer.headers, ...webFrontHeaders() }, body: answer.body }
}

const ACCESS_LOGIN = 'https://example-team.cloudflareaccess.com/cdn-cgi/access/login/formancy.example.com?kid=x&redirect_url=%2Fstudio%2F'
/** Shapes the edge answers in, for the cases below; none is captured from a real account. */
const EDGE = {
  // Access's redirect to its login, by the documented path; the query is
  // not documented and is not read.
  access: { status: 302, headers: { location: ACCESS_LOGIN }, body: '' },
  // A WAF block as Cloudflare's structured error (error-responses.mdx's
  // fields, error_code 1020), not a captured answer.
  waf: { status: 403, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Error 1020: Access denied', status: 403, error_code: 1020, cloudflare_error: true }) },
  // cloudflared's catch-all, `http_status:404`: a 404 without the web
  // front's headers. Its body is not measured and not read.
  catchAll: { status: 404, headers: {}, body: '' },
  // A host application's own page, through its own service.
  spa: { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>Host</title>' },
}

describe('Access answered first', () => {
  const expectation = { kind: 'access', method: 'GET', scheme: 'https', host: inputs.admin, path: '/studio/' }

  // The administrator's door is Access's redirect or it is open: the
  // studio's page, the server's own 401, a WAF block and a redirect to
  // anywhere else are each the door answering without Access.
  test('is exactly a redirect to the team’s Access login', async () => {
    expect(verdict(expectation, EDGE.access, inputs).pass).toBe(true)
    for (const response of [
      { status: 200, headers: webFrontHeaders(), body: '<!doctype html>' },
      await throughWebFront('GET', '/v1/whoami'),
      EDGE.waf,
      { status: 302, headers: { location: 'https://other-team.cloudflareaccess.com/cdn-cgi/access/login/x' }, body: '' },
      { status: 302, headers: { location: '/studio/' }, body: '' },
      { status: 301, headers: { location: ACCESS_LOGIN }, body: '' },
    ]) {
      expect(verdict(expectation, response, inputs), String(response.status)).toEqual({ pass: false, saw: expect.stringMatching(/without Access$/) })
    }
  })
})

describe('redirected to HTTPS', () => {
  const expectation = { kind: 'https', method: 'GET', scheme: 'http', host: inputs.admin, path: '/studio/' }

  // Always Use HTTPS sends plain HTTP to the same place over TLS; a
  // redirect elsewhere, or an answer over plain HTTP, is not that.
  test('is a 301 or 308 to exactly the same host and path over HTTPS', () => {
    for (const status of [301, 308]) expect(verdict(expectation, { status, headers: { location: 'https://formancy.example.com/studio/' }, body: '' }, inputs).pass).toBe(true)
    for (const response of [
      { status: 302, headers: { location: 'https://formancy.example.com/studio/' } },
      { status: 301, headers: { location: 'https://formancy.example.com/' } },
      { status: 301, headers: { location: 'https://evil.example/studio/' } },
      EDGE.access,
    ]) {
      expect(verdict(expectation, { body: '', ...response }, inputs).pass).toBe(false)
    }
  })
})

describe('reached the data server', () => {
  const route = doors.routes.find((entry) => entry.plane === 'runtime' && entry.method === 'POST')
  const expectation = { kind: 'server', method: route.method, scheme: 'https', host: inputs.app, path: route.sample }

  // A runtime route through the runtime door must arrive at the server,
  // which asks for a token: its own 401 through nginx, as the built server
  // answers. A page, Cloudflare's 404, a block or the server's answer
  // without nginx's headers is something else answering.
  test('is the server’s 401 for a missing token, through the web front', async () => {
    const answer = await throughWebFront(route.method, route.sample)
    expect(answer.status).toBe(401)
    expect(verdict(expectation, answer, inputs).pass).toBe(true)
    const bare = await app.inject({ method: route.method, url: route.sample })
    for (const response of [EDGE.catchAll, EDGE.spa, EDGE.waf, EDGE.access, { status: bare.statusCode, headers: bare.headers, body: bare.body }, await throughWebFront('GET', '/health')]) {
      expect(verdict(expectation, response, inputs).pass, String(response.status)).toBe(false)
    }
  })
})

describe('did not reach the web front', () => {
  const route = doors.routes.find((entry) => entry.plane === 'administrator' && entry.method === 'GET' && entry.path.includes('/:'))
  const expectation = { kind: 'outside', method: route.method, scheme: 'https', host: inputs.app, path: route.sample }

  // Every other path on the runtime door: cloudflared's 404, a host
  // application's page, a block -- anything nginx did not answer -- the
  // server's refusal of a path that is not plain, given before any route's
  // work, or nginx's own 404 from the runtime door's server in nginx.conf,
  // which serves no file. An administrator's route answered through nginx,
  // the studio's page, or the server's own 404 is a door that forwarded it.
  test('is anything the web front did not answer, the server’s path-not-plain, or nginx’s own 404', async () => {
    const hostile = C6.find((entry) => entry.path.includes('versions/..%2F'))
    const refused = await throughWebFront(hostile.method, hostile.path)
    expect([refused.status, JSON.parse(refused.body).code]).toEqual([400, 'path-not-plain'])
    const nginx404 = { status: 404, headers: { ...webFrontHeaders(), 'content-type': 'text/html' }, body: fixture('nginx-404.html') }
    for (const response of [EDGE.catchAll, EDGE.spa, EDGE.waf, refused, nginx404]) expect(verdict(expectation, response, inputs).pass, String(response.status)).toBe(true)
    for (const response of [await throughWebFront(route.method, route.sample), { status: 200, headers: { ...webFrontHeaders(), 'cache-control': 'no-cache' }, body: '<!doctype html>' }, await throughWebFront('GET', '/v1/nothing')]) {
      expect(verdict(expectation, response, inputs), String(response.status)).toEqual({ pass: false, saw: expect.stringMatching(/^reached the web front/) })
    }
  })

  // The headers that say "nginx answered" are the ones nginx.conf adds: if
  // it stopped adding one, every forwarded answer would read as outside.
  test('knows the web front by the headers nginx.conf adds', () => {
    expect(webFrontHeaders()).toEqual(WEB_FRONT)
  })

  // "Outside" passes whatever lacks nginx's headers, so it leans on the
  // runtime routes' lines: an edge feature that rewrites those headers --
  // Cloudflare's "Add security headers" sets X-Frame-Options SAMEORIGIN and
  // Referrer-Policy same-origin (managed-transforms/reference.mdx) -- would
  // hide the studio's page from "outside", and is caught only because the
  // same run asks for a runtime route the server must answer through nginx.
  // So a run that checks the runtime door always asks for one, and that
  // line fails on rewritten headers.
  test('is trusted only beside a runtime route the server must answer with nginx’s own headers', async () => {
    const list = expectations(doors, inputs)
    expect(list.some((entry) => entry.kind === 'outside')).toBe(true)
    expect(list.filter((entry) => entry.kind === 'server').length).toBe(doors.routes.filter((entry) => entry.plane === 'runtime').length)
    const route = doors.routes.find((entry) => entry.plane === 'runtime')
    const answer = await throughWebFront(route.method, route.sample)
    const rewritten = { ...answer, headers: { ...answer.headers, 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'same-origin' } }
    expect(verdict({ kind: 'server', method: route.method, scheme: 'https', host: inputs.app, path: route.sample }, rewritten, inputs).pass).toBe(false)
    expect(verdict(expectation, { status: 200, headers: rewritten.headers, body: '<!doctype html>' }, inputs).pass).toBe(true)
  })
})

describe('no answer at all', () => {
  // A DNS typo, a TLS failure, a tunnel that is down or a timeout is no
  // answer: it says nothing of a door. Read as an answer, status 0 would be
  // "answered 0 without Access", an open door to whoever reads it, and would
  // pass "outside", which passes what lacks nginx's headers. Each verdict
  // fails it as no answer, with the reason the request ended.
  test('fails every verdict, and says why the request ended', () => {
    const route = doors.routes.find((entry) => entry.plane === 'runtime')
    for (const kind of ['access', 'https', 'server', 'outside']) {
      const expectation = { kind, method: 'GET', scheme: kind === 'https' ? 'http' : 'https', host: kind === 'access' || kind === 'https' ? inputs.admin : inputs.app, path: route.sample }
      for (const reason of ['ENOTFOUND', 'timeout']) {
        expect(verdict(expectation, { status: 0, headers: {}, body: '', error: reason }, inputs), `${kind} ${reason}`).toEqual({ pass: false, saw: `no answer (${reason})` })
      }
    }
  })
})

describe('the requests', () => {
  // Each door is asked about every route; the runtime door about the pages
  // and the paths cloudflared reads differently too. The four hostile
  // paths are ones the CI job sends through cloudflared and the built
  // server, so the live check asks about paths the gate shows refused.
  test('ask both doors about every route, and the runtime door about four paths the gate sends', () => {
    const list = expectations(doors, inputs)
    for (const route of doors.routes) {
      expect(list).toContainEqual(expect.objectContaining({ host: inputs.admin, path: route.sample, kind: 'access' }))
      expect(list).toContainEqual(expect.objectContaining({ host: inputs.app, path: route.sample, kind: route.plane === 'runtime' ? 'server' : 'outside' }))
    }
    expect(list.filter((entry) => entry.kind === 'https').map((entry) => entry.host)).toEqual([inputs.admin, inputs.app])
    const conf = readFileSync(join(repo, 'deploy', 'web', 'nginx.conf'), 'utf8')
    const hostile = hostilePaths(doors, { statics: staticLocations(conf) })
    const gate = hostile.map((entry) => `${entry.method} ${entry.path}`)
    for (const entry of C6) {
      expect(gate).toContain(`${entry.method} ${entry.path}`)
      expect(list).toContainEqual(expect.objectContaining({ ...entry, host: inputs.app, kind: 'outside' }))
    }
    // One of them climbs out of a location that serves files, which the
    // server never sees when nginx answers it; the gate sends it through
    // nginx.conf.
    expect(C6.some((entry) => hostile.find((path) => path.path === entry.path)?.route?.startsWith('the web front'))).toBe(true)
    expect(expectations(doors, { admin: inputs.admin, team: inputs.team }).every((entry) => entry.host === inputs.admin)).toBe(true)
  })

  // The output is one line per request and the count; a failed line says
  // what it saw, so an operator knows which setting to look at.
  test('are printed one line each, a failure with what it saw, then the count', () => {
    const [first, second] = expectations(doors, inputs)
    const text = render([{ expectation: first, pass: true }, { expectation: second, pass: false, saw: 'answered 200 without Access' }], inputs)
    expect(text.split('\n')).toEqual([
      'doors-check: formancy.example.com (administrator), app.example.com (runtime), team example-team',
      'pass  GET https://formancy.example.com/studio/  Access answered first',
      'FAIL  GET https://formancy.example.com/host/  answered 200 without Access',
      '2 requests, 1 as expected, 1 not.',
    ])
  })

  // fromServer is what tells the server's answer from anything else; a
  // body nginx answered itself is not the server's.
  test('tell the server’s answer by nginx’s headers, no-store and a JSON code or status', async () => {
    expect(fromServer(await throughWebFront('GET', '/health'))).toBe(true)
    expect(fromServer({ status: 404, headers: webFrontHeaders(), body: '<html>404</html>' })).toBe(false)
    expect(fromServer({ status: 530, headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ status: 530, error_code: 1033 }) })).toBe(false)
  })
})
