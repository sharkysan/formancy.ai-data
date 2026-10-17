import { claimsFor, COOKIE_NAME, handle, mintToken, notRunning, personaById, PREFIX } from '@formancy/data-live-demo/worker'
import type { DemoInstance } from '@formancy/data-live-demo/worker'
import type { Plane, Sent } from './test-plane.js'

/*
 * The live demo's page in a test (0070): the host page as it is built for
 * formancy.ai/data/demo/, in front of the real server the way the demo's
 * Worker puts it there.
 *
 * What is the Worker's is the Worker's own code -- `handle` from
 * @formancy/data-live-demo/worker, with its routes, its sign-in checks, its
 * cookie, its refusals and its forwarding -- not a second reading of it.
 * Two things stand in for what only a browser and Cloudflare have:
 *
 * - The visitor's instance, their Durable Object and its container, which
 *   signs a persona's token with the plane's demo key -- the key the
 *   plane's server verifies, as a container verifies the key it was started
 *   with -- and sends what the Worker forwards to the plane's server. One
 *   key for the plane's life, where a Durable Object makes one per start:
 *   that a token dies with its container is the image gate's to show.
 * - The browser around the page: the origin it is served from, the headers
 *   a browser adds to a same-origin fetch and a script cannot set, and the
 *   one cookie, kept from the Worker's Set-Cookie and sent back under the
 *   demo's path, never shown to the page.
 */

/** Where the demo's page is served from here: an origin of its own, as formancy.ai is. */
export const DEMO_ORIGIN = 'https://demo.test'

/** The page's own address, which a relative URL the page fetches is resolved against. */
const PAGE = `${DEMO_ORIGIN}${PREFIX}/`

export interface DemoDoor {
  /** The page's `fetch`: the browser's, on the demo's page, with the Worker behind it. */
  fetch: typeof fetch
  /** Every request the page made, as it made it: before the browser added its headers and the cookie. */
  sent: Sent[]
  /** Every token a sign-in gave out, in order. */
  tokens: string[]
  /** The next sign-in starts nothing, as a start that fails, or finds no room under max_instances, does. */
  failNextStart(): void
  /** The visitor's server stops, as it does once their idle time is out. */
  stop(): void
}

/** The value of the demo's cookie in a Set-Cookie header, as a browser keeps it; undefined when it sets another. */
function cookieValue(header: string): string | undefined {
  const pair = header.split(';')[0] ?? ''
  const at = pair.indexOf('=')
  return at !== -1 && pair.slice(0, at).trim() === COOKIE_NAME ? pair.slice(at + 1).trim() : undefined
}

/**
 * The demo's page and its Worker, in front of `plane`'s server, which must
 * have been started with `demo` so that it verifies what the instance signs.
 */
export function demoDoor(plane: Pick<Plane, 'fetch' | 'demoKey'>): DemoDoor {
  const key = plane.demoKey
  if (key === undefined) throw new Error('the plane was started without demo: its server would refuse every token the demo signs')
  const sent: Sent[] = []
  const tokens: string[] = []
  const running = new Set<string>()
  let failing = false
  let cookie: string | undefined

  /** The forwarded request, as the plane's fetch takes one: at its path and query on the server, with the headers the Worker let through. */
  const toServer = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const body = request.body === null ? undefined : await request.text()
    return plane.fetch(`${url.pathname}${url.search}`, { method: request.method, headers: Object.fromEntries(request.headers.entries()), ...(body === undefined ? {} : { body }) })
  }

  const named = (name: string): DemoInstance => ({
    signIn: async (id) => {
      const persona = personaById(id)
      if (failing || persona === undefined) {
        failing = false
        return { ok: false }
      }
      running.add(name)
      const minted = await mintToken(key, claimsFor(persona))
      tokens.push(minted.token)
      return { ok: true, ...minted }
    },
    fetch: async (request) => (running.has(name) ? toServer(request) : notRunning()),
  })

  return {
    sent,
    tokens,
    failNextStart: () => {
      failing = true
    },
    stop: () => running.clear(),
    fetch: async (input, init) => {
      const href = input instanceof Request ? input.url : String(input)
      const url = new URL(href, PAGE)
      const method = (init?.method ?? 'GET').toUpperCase()
      const headers = new Headers(init?.headers)
      const body = typeof init?.body === 'string' ? init.body : undefined
      sent.push({ method, url: href, path: url.pathname, headers: Object.fromEntries(headers.entries()), body })
      const signal = init?.signal ?? undefined
      signal?.throwIfAborted()
      // What a browser adds to a fetch of its own origin in fetch's default
      // mode, and a script cannot set: the Origin of a request that is not a
      // GET or a HEAD, where the request was made from, and the cookie the
      // path holds.
      if (method !== 'GET' && method !== 'HEAD') headers.set('origin', url.origin)
      headers.set('sec-fetch-site', url.origin === DEMO_ORIGIN ? 'same-origin' : 'cross-site')
      headers.set('sec-fetch-mode', 'cors')
      headers.set('sec-fetch-dest', 'empty')
      if (cookie !== undefined && url.origin === DEMO_ORIGIN && url.pathname.startsWith(`${PREFIX}/`)) headers.set('cookie', `${COOKIE_NAME}=${cookie}`)
      const answer = await handle(new Request(url, { method, headers, ...(body === undefined ? {} : { body }) }), named)
      signal?.throwIfAborted()
      const set = answer.headers.get('set-cookie')
      if (set !== null) cookie = cookieValue(set) ?? cookie
      // A script never reads Set-Cookie: Fetch filters it out of every answer.
      const seen = new Response(answer.body, answer)
      seen.headers.delete('set-cookie')
      return seen
    },
  }
}
