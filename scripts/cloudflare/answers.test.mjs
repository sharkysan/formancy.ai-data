import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * What a host page makes of what Cloudflare and nginx answer in the server's
 * place (0037, against 0031): `createDataClient` as published, from
 * packages/data-client/dist, with a fake `fetch` answering each answer below.
 * A write that met an answer nobody here can vouch for is unknown, never
 * "not saved", because the server may have committed it; a refusal is read
 * only from an answer with a sentence, the server's own -- or the edge's
 * rate-limit body, which is written to be one, because a blocked request
 * never reaches the server and nothing was written.
 *
 * The answers, and where each comes from:
 * - fixtures/cloudflare-522.json: the JSON example for 522 in Cloudflare's
 *   docs, src/content/docs/fundamentals/reference/error-responses.mdx at
 *   cloudflare-docs 0d35c2c (2026-10-10), verbatim;
 * - fixtures/cloudflare-530-1033.json and cloudflare-403-1020.json: built
 *   from that page's field list for a tunnel that is down (1033, which the
 *   page lists as retryable after 120 s) and a firewall block (1020); no
 *   answer of either was captured, since no account was available;
 * - fixtures/cloudflare-429-1015.json: built the same way for the edge's
 *   rate-limiting rule on the Free plan, which cannot have a custom
 *   response ("only available on Pro plans and above",
 *   waf/rate-limiting-rules/create-zone-dashboard.mdx at 0d35c2c), so its
 *   Block answers with Cloudflare's own error: 1015, in the page's
 *   rate_limit category and retryable after 30 s, at 429, the response code
 *   the docs give a rule by default (partials/waf/custom-response-blocked-
 *   requests.mdx) -- what status Free's own answer carries is not written
 *   there, and nothing here reads the status of an answer without a
 *   `message`; not captured;
 * - fixtures/nginx-504.html: what nginxinc/nginx-unprivileged:1.30.5-alpine,
 *   the web front's base, answered with `server_tokens off` when its upstream
 *   accepted the connection and never answered, captured on 2026-10-11 (line
 *   ends made LF, as the repository stores text);
 * - Access's redirect to its login, by the path Cloudflare documents;
 * - deploy/cloudflare/rate-limited.json, the body the guide has the edge's
 *   rate-limiting rule answer with; and the data server's own path-not-plain
 *   body, from the built server.
 *
 * It needs `pnpm build`.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { createDataClient, isUnknownWrite } = await import(pathToFileURL(join(repo, 'packages', 'data-client', 'dist', 'index.mjs')).href)
const fixture = (name) => readFileSync(join(repo, 'scripts', 'cloudflare', 'fixtures', name), 'utf8')
const rateLimited = readFileSync(join(repo, 'deploy', 'cloudflare', 'rate-limited.json'), 'utf8')

/** The built server's answer to a path that is not plain, as the client receives it. */
async function pathNotPlain() {
  const server = await import(pathToFileURL(join(repo, 'packages', 'data-server', 'dist', 'index.mjs')).href)
  const app = await server.createDataServer({ verifyIdentity: async () => ({ ok: false, reason: 'none' }) })
  try {
    const answer = await app.inject({ method: 'GET', url: '/v1/whoami/' })
    return { status: answer.statusCode, type: answer.headers['content-type'], body: answer.body }
  } finally {
    await app.close()
  }
}

/** A client whose every request is answered `status`, `type` and `body`, as the edge or nginx would. */
const clientAnswering = (status, type, body, headers = {}) =>
  createDataClient({ token: () => 'a-token', fetch: async () => new Response(body, { status, headers: { 'content-type': type, ...headers } }) })

const json = 'application/json; charset=utf-8'

describe('an answer the data server did not give', () => {
  // A 522 is the edge's: it could not reach the origin in time, and the
  // origin may still have done the work. A write that met it may have been
  // saved; a read is an answer this client does not understand, never data.
  test.each([
    ['Cloudflare’s documented 522', 522, json, fixture('cloudflare-522.json')],
    ['a 530 for a tunnel that is down (error 1033)', 530, json, fixture('cloudflare-530-1033.json')],
    ['a firewall block (error 1020)', 403, json, fixture('cloudflare-403-1020.json')],
    // On Free the edge's rate-limiting rule can only answer with this: a
    // write it blocked was never sent, and still reads as one that may have
    // been saved, which the guide says is what Free costs.
    ['the edge’s rate-limiting block on the Free plan (error 1015)', 429, json, fixture('cloudflare-429-1015.json')],
    ['nginx’s own 504', 504, 'text/html', fixture('nginx-504.html')],
  ])('%s makes a write unknown and a read unexpected', async (_, status, type, body) => {
    const client = clientAnswering(status, type, body)
    const created = await client.create('order', { amount: '1.00' })
    expect(isUnknownWrite(created)).toBe(true)
    expect(created).toMatchObject({ status, code: 'unknown-outcome', origin: 'transport', operation: 'create' })
    expect(await client.form('order')).toMatchObject({ ok: false, status, code: 'unexpected' })
  })

  // Access answers a lapsed session with a redirect to its login. The
  // client follows no redirect, so the token never travels to another host,
  // and a write that met one is unknown: nothing says it did not arrive.
  test('Access’s redirect to its login makes a write unknown, and the token goes nowhere', async () => {
    const asked = []
    const client = createDataClient({
      token: () => 'a-token',
      fetch: async (url, init) => {
        asked.push({ url, redirect: init.redirect })
        return new Response('', { status: 302, headers: { location: 'https://example-team.cloudflareaccess.com/cdn-cgi/access/login/app.example.com' } })
      },
    })
    expect(isUnknownWrite(await client.create('order', {}))).toBe(true)
    expect(await client.form('order')).toMatchObject({ ok: false, status: 302, code: 'unexpected' })
    expect(asked.map((entry) => entry.redirect)).toEqual(['manual', 'manual'])
  })
})

describe('a refusal, with nothing written', () => {
  // The edge's rate-limiting rule blocks before forwarding, so nothing was
  // written; on Pro and above its custom JSON body carries a sentence so the
  // client says so, rather than "may have been saved". Without `message` it
  // would read as unknown, as Free's own 1015 does above.
  test('the edge’s rate-limit body at 429 is a refusal with its code and sentence, for a write and a read', async () => {
    const body = JSON.parse(rateLimited)
    const client = clientAnswering(429, 'application/json', rateLimited)
    expect(await client.create('order', {})).toEqual({ ok: false, status: 429, code: 'rate-limited', message: body.message })
    expect(await client.form('order')).toEqual({ ok: false, status: 429, code: 'rate-limited', message: body.message })
  })

  // The server refuses a path that is not plain before any route's work,
  // so a write that met that refusal was not written.
  test('the server’s path-not-plain is a refusal', async () => {
    const answer = await pathNotPlain()
    expect(answer.status).toBe(400)
    const client = clientAnswering(answer.status, answer.type, answer.body)
    expect(await client.create('order', {})).toMatchObject({ ok: false, status: 400, code: 'path-not-plain' })
    expect(isUnknownWrite(await client.create('order', {}))).toBe(false)
  })
})
