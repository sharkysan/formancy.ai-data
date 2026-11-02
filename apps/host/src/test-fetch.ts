import type { createDataServer } from '@formancy/data-server'

/*
 * The page's `fetch` onto the plane's server, in process: what the page
 * asks, recorded as anybody on the wire would see it, and answered by the
 * real server's routes (0029). Apart from the plane, which publishes and
 * seeds what those routes serve.
 */

/** One request as the page sent it: what the server, and anybody on the wire, would see. */
export interface Sent {
  method: string
  /** The URL as the page wrote it, query string included. */
  url: string
  path: string
  headers: Record<string, string>
  body: string | undefined
  /** The server's status once it answered, and an error's `code`: what a failing test can say it was told. */
  status?: number
  code?: string | undefined
}

/** An error answer's `code`, or undefined when its body is not JSON that names one. */
function codeOf(body: string): string | undefined {
  try {
    const { code } = JSON.parse(body) as { code?: unknown }
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

/**
 * `app.inject` as a `fetch`, recording what was asked into `sent` when given a
 * list. Every request still being answered is in `pending`: a renderer that
 * abandons a search rejects its fetch, and the server goes on asking the
 * database, so closing the plane waits for those rather than pulling the
 * connections out from under them.
 */
export function injectingFetch(app: Awaited<ReturnType<typeof createDataServer>>, pending: Set<Promise<unknown>>, sent?: Sent[]): typeof fetch {
  return async (input, init) => {
    const href = input instanceof Request ? input.url : String(input)
    const url = new URL(href, 'http://host.test')
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = typeof init?.body === 'string' ? init.body : undefined
    const entry: Sent = { method, url: href, path: url.pathname, headers, body }
    sent?.push(entry)
    // A renderer abandons a search when the next keystroke arrives; the
    // browser's fetch then rejects with the signal's reason, and so does this.
    const signal = init?.signal ?? undefined
    signal?.throwIfAborted()
    const answering = Promise.resolve(
      app.inject({ method: method as 'GET' | 'POST', url: `${url.pathname}${url.search}`, headers, ...(body === undefined ? {} : { payload: body }) }),
    )
    pending.add(answering)
    void answering.finally(() => pending.delete(answering)).catch(() => {})
    const reply = await answering
    entry.status = reply.statusCode
    if (reply.statusCode >= 400) entry.code = codeOf(reply.body)
    signal?.throwIfAborted()
    const answered = new Headers()
    for (const [name, value] of Object.entries(reply.headers)) {
      if (value !== undefined) answered.set(name, Array.isArray(value) ? value.join(', ') : String(value))
    }
    // The bytes as the server sent them: a file is compared byte for byte (0080).
    return new Response(reply.statusCode === 204 ? null : new Uint8Array(reply.rawPayload), { status: reply.statusCode, headers: answered })
  }
}
