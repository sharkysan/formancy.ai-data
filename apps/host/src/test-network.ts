/*
 * What the network between the page and the data server does when a test
 * says so: an answer held until the test hands it over, a request held
 * before it is sent, or an answer lost as a dropped connection loses it.
 * Each wraps a `fetch` -- the plane's (test-plane.ts), or the demo's door in
 * front of it (test-demo.ts) -- and passes on whatever it is not told to hold
 * or lose.
 */

/** A `fetch` whose writes are answered late, when the test says so: see `holdingWrites`. */
export interface Holding {
  fetch: typeof fetch
  /** The path of every write the server has answered and this is still holding, oldest first. */
  held: string[]
  /** Hand the oldest held answer to whoever asked. */
  answer(): void
}

/**
 * `fetch` with every create and update held after the server has answered it:
 * the record is written, and the page does not know yet. That is the moment a
 * person goes on typing, presses Save again or opens another record, and on
 * `app.inject` it otherwise lasts too few ticks to reach. Reads and lookups
 * pass straight through.
 */
export function holdingWrites(fetch: typeof globalThis.fetch): Holding {
  const waiting: Array<() => void> = []
  const held: string[] = []
  return {
    held,
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      if (!/\/records\/(create|update)$/.test(path)) return fetch(input, init)
      const reply = await fetch(input, init)
      held.push(path)
      await new Promise<void>((resolve) => waiting.push(resolve))
      held.splice(held.indexOf(path), 1)
      return reply
    },
    answer: () => {
      waiting.shift()?.()
    },
  }
}

/** A `fetch` that holds the requests it is told to, until the test lets each go: see `holdingRequests`. */
export interface Held {
  fetch: typeof fetch
  /** The path of every request held and not yet let go, oldest first. */
  held: string[]
  /** Send the oldest held request on to the real server; settles once its answer is handed back to the page. */
  pass(): Promise<void>
  /** Fail the oldest held request as a dropped connection does, with the browser's own `TypeError`. */
  fail(): Promise<void>
}

/**
 * `fetch` with each request `holds` picks kept back before it is sent: a
 * record's read, or a form's definition, that the person has moved past by
 * the time it is answered. On `app.inject` an answer otherwise arrives within
 * a few ticks, before a person could do anything else. Everything else
 * passes straight through. What `pass` and `fail` settle on is the answer
 * handed back; what the page then does with it is a few ticks more.
 */
export function holdingRequests(fetch: typeof globalThis.fetch, holds: (request: { method: string; path: string; body: string | undefined }) => boolean): Held {
  const waiting: Array<(go: boolean) => Promise<void>> = []
  const held: string[] = []
  const release = async (go: boolean): Promise<void> => {
    const next = waiting.shift()
    if (next === undefined) throw new Error('no request is held')
    await next(go)
  }
  return {
    held,
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      const method = (init?.method ?? 'GET').toUpperCase()
      if (!holds({ method, path, body: typeof init?.body === 'string' ? init.body : undefined })) return fetch(input, init)
      held.push(path)
      let answered: () => void = () => {}
      const handedBack = new Promise<void>((resolve) => {
        answered = resolve
      })
      const go = await new Promise<boolean>((resolve) =>
        waiting.push(async (decided) => {
          resolve(decided)
          await handedBack
        }),
      )
      held.splice(held.indexOf(path), 1)
      try {
        if (!go) throw new TypeError('Failed to fetch')
        return await fetch(input, init)
      } finally {
        answered()
      }
    },
    pass: () => release(true),
    fail: () => release(false),
  }
}

/** A `fetch` that loses the answers to writes: see `losingWrites`. */
export interface Losing {
  fetch: typeof fetch
  /** The path of every write whose answer it lost: `times` at most. */
  lost: string[]
}

/**
 * `fetch` that loses the answer to the next create or update, as a network
 * between the page and the data server does (0031), and passes everything
 * else through. `after`: the request reaches the real server, which stores
 * it and answers, and the page is told the fetch failed -- what the browser
 * says when the connection drops after sending. `before`: it fails without
 * reaching the server, which the page cannot tell apart from `after`. Either
 * way the rejection is the browser's own `TypeError`, so the client sees
 * exactly what it would see in a page. Once, unless `times` says more: what
 * the page does next is what is under test, and it must reach the server.
 */
export function losingWrites(
  fetch: typeof globalThis.fetch,
  { when, times = 1, writes = /\/records\/(create|update)$/ }: { when: 'after' | 'before'; times?: number; writes?: RegExp },
): Losing {
  const lost: string[] = []
  return {
    lost,
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      if (lost.length >= times || !writes.test(path)) return fetch(input, init)
      lost.push(path)
      if (when === 'after') await fetch(input, init)
      throw new TypeError('Failed to fetch')
    },
  }
}
