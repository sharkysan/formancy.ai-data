import { createHash } from 'node:crypto'
import { WRITE_ID_HEADER } from '@formancy/data-core'
import type { FastifyRequest } from 'fastify'

/*
 * A write applied at most once per sending (0031).
 *
 * Nothing in this repository sends a write again, but the browser does:
 * Chromium resends a request -- a POST too -- when the connection it reused
 * closed before any byte of the answer came back. Measured with Playwright's
 * Chromium on 2026-10-09: a create whose answer was lost after the server
 * stored it reached the server twice, and the page saw only the second
 * answer, a 201, over two stored records. The host's page reuses its
 * connections for nearly every write, because the form, the record and the
 * lookups come first.
 *
 * So the client names each sending with a random id, and a request that
 * arrives with an id this server has already acted on is not applied: it is
 * answered with the first sending's answer -- awaited, if that is still with
 * the database -- which is the answer the page should have had. The id is
 * the person's, the form's and the operation's, so another of each is
 * another write; and the same id with another body is refused, because
 * answering it with the first write's answer would say "Created" about
 * something never sent.
 *
 * What it does not do: it holds in this process only. A resend that reaches
 * another replica behind a balancer, or this one after a restart, is applied
 * again; and a request without an id -- a client of the deployment's own --
 * is a write of its own every time. 0031 writes both down.
 */

/** What a write route answers: the status, the body, and the record the audit names. */
export interface WriteAnswer {
  status: number
  body: unknown
  record?: string | undefined
}

/**
 * How long a sending's answer is kept for a resend, and how much is kept.
 *
 * Measured on 2026-10-09 by the host page's browser gate
 * (apps/host/scripts/browser-test.mjs, "Create resent by Chromium"), with
 * Playwright's Chromium against the real server on PostgreSQL, six runs: the
 * resend reached the server 5 to 6 ms after the connection closed -- the
 * gate polls every 5 ms, so that is its resolution -- and the order form's
 * create answer was 234 to 236 bytes as JSON. Ten minutes is a margin over
 * those milliseconds for a slower client, not a measurement of one; ten
 * thousand such answers are about 2.4 MB, and the byte cap is there for a
 * form whose records are large. Oldest dropped first, so a person sending
 * large records under fresh ids cannot make this server hold more: a resend
 * that arrives after its answer was dropped is applied again.
 */
export const KEEP_MS = 10 * 60_000
export const MAX_KEPT = 10_000
export const MAX_KEPT_BYTES = 32 * 1024 * 1024

/** What a write id must look like: the client's are 32 hex characters; anything of 16 to 64 URL-safe characters is taken. */
const WRITE_ID = /^[A-Za-z0-9_-]{16,64}$/

/** The request's write id; undefined when it has none; null when it has one that is not one. */
export function writeId(request: FastifyRequest): string | undefined | null {
  const value = request.headers[WRITE_ID_HEADER]
  if (value === undefined) return undefined
  return typeof value === 'string' && WRITE_ID.test(value) ? value : null
}

/** The refusal of a malformed id, or of an id that came back with another write. Nothing was sent. */
export const INVALID_WRITE_ID: WriteAnswer = {
  status: 400,
  body: { code: 'invalid-request', message: `The ${WRITE_ID_HEADER} header is not one write's id. Nothing was saved.` },
}
const REUSED_WRITE_ID: WriteAnswer = {
  status: 400,
  body: { code: 'invalid-request', message: 'This write id was sent before with a different write. Nothing was saved.' },
}

interface Kept {
  digest: string
  until: number
  answer: Promise<WriteAnswer>
  /** The answer's size as UTF-8 JSON once it is in; nothing while it is with the database. */
  bytes: number
}

export function createWriteOnce(now: () => number = Date.now) {
  const kept = new Map<string, Kept>()
  let bytes = 0

  /** Drops what has expired, and the oldest past either bound. Insertion order is expiry order. */
  function prune(): void {
    for (const [key, entry] of kept) {
      if (entry.until > now() && kept.size <= MAX_KEPT && bytes <= MAX_KEPT_BYTES) break
      kept.delete(key)
      bytes -= entry.bytes
    }
  }

  return {
    /**
     * `perform`'s answer, the first time this id is sent for this write; the
     * same answer, with `repeated`, every later time within KEEP_MS. The
     * check and the claim are one synchronous step, so two sendings that
     * arrive together cannot both perform.
     */
    async once(scope: { actor: string; form: string; operation: 'create' | 'update'; id: string; body: unknown }, perform: () => Promise<WriteAnswer>): Promise<WriteAnswer & { repeated: boolean }> {
      prune()
      const key = JSON.stringify([scope.actor, scope.form, scope.operation, scope.id])
      const digest = createHash('sha256').update(JSON.stringify(scope.body) ?? '').digest('hex')
      const earlier = kept.get(key)
      if (earlier !== undefined) {
        if (earlier.digest !== digest) return { ...REUSED_WRITE_ID, repeated: false }
        return { ...(await earlier.answer), repeated: true }
      }
      const answer = perform()
      const entry: Kept = { digest, until: now() + KEEP_MS, answer, bytes: 0 }
      kept.set(key, entry)
      answer.then(
        (settled) => {
          // Counted only while it is still kept: an entry pruned in flight holds nothing.
          if (kept.get(key) !== entry) return
          entry.bytes = Buffer.byteLength(JSON.stringify(settled.body) ?? '', 'utf8')
          bytes += entry.bytes
        },
        // A rejection is the first sending's to report; a resend that awaits it reports it too.
        () => {},
      )
      return { ...(await answer), repeated: false }
    },
  }
}
