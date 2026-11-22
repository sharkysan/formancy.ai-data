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
 * another write -- a delete's included (0050), whose answer is a token and
 * `deleted`, so nothing of a deleted record is kept, and a save of a record
 * with its rows (0155), whose answer is the record and every row it wrote,
 * kept under the same byte cap as any other -- a delete of a page's
 * chosen records (0173), `delete-chosen`, whose answer is each record's
 * outcome as a delete of it alone answers it, a change of them (0175),
 * `update-chosen`, each record's as an update of it alone answers it --
 * and a run of an action
 * (0161), each action an operation of its own, `action:<name>`, whose
 * answer is the tokens it addressed; and the same id with another body is
 * refused, because
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
 * form whose records are large -- and for a save of a record with its rows
 * (0155): measured on 2026-11-16 through the real server on the default
 * images, the fixture's order saved with 49 lines answered 7,508 bytes on
 * PostgreSQL and 9,758 on SQL Server, so the cap holds about 4,400 and
 * 3,400 of those, and saves of more than about 21 lines on PostgreSQL,
 * 16 on SQL Server, fill it before the count does. A delete of a page of
 * chosen records (0173) keeps one answer per record: counted on 2026-11-22
 * as the JSON the route answers in the server's own sentences, 50 records
 * deleted are 3,663 bytes with seven-digit keys and 50 stale ones 7,713, so
 * the cap holds about 9,100 and 4,300 such pages and the count bounds
 * first; 50 declined in a deployment's own words at their longest -- a
 * message of 2,046 UTF-16 code units, `REFUSAL_LONGEST`, prefix included,
 * so 2,027 of reason -- are about 105 KB in ASCII and up to about 307 KB
 * in a script of three UTF-8 bytes to a code unit, so between about 320
 * and 109 of them fill it. A change of a page of chosen records (0175)
 * keeps each record's update answer, the record as stored among them:
 * counted on 2026-11-22 as the JSON the built route answers over fake
 * ports for the shared fixture's order form, seven-digit keys, its edge
 * amount and a short note, 50 orders changed are 14,263 bytes and 50 stale
 * ones 7,413, so the cap holds about 2,350 and 4,500 such pages, and a
 * page of changed orders fills it before the count does; a record's
 * answer grows with what it holds, and notes of 10 KB each would make a
 * page about half a megabyte and some 60 of them the cap.
 * bulk-sized.integration.test.ts reports a page of deletes' and of
 * changes' bytes through the real server. Oldest dropped first,
 * so a person sending large records under fresh ids cannot make this
 * server hold more: a resend that arrives after its answer was dropped is
 * applied again.
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

/** Whose sending of what: another person, form, operation or id is another write. */
interface Scope {
  actor: string
  form: string
  operation: 'create' | 'update' | 'delete' | 'delete-chosen' | 'update-chosen' | 'supersede' | 'save' | `action:${string}`
  id: string
  body: unknown
}

const keyOf = (scope: Scope): string => JSON.stringify([scope.actor, scope.form, scope.operation, scope.id])
const digestOf = (body: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(body) ?? '')
    .digest('hex')

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
    async once(scope: Scope, perform: () => Promise<WriteAnswer>): Promise<WriteAnswer & { repeated: boolean }> {
      prune()
      const key = keyOf(scope)
      const digest = digestOf(scope.body)
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

    /**
     * The answer an earlier sending of this id with this body was given,
     * with `repeated` -- awaited, if it is still with the database -- or
     * undefined when none is kept, or when the one kept is another body's,
     * which `once` refuses. Nothing is claimed: for a route that refuses
     * before `once` by what the form says now (0161), so a sending already
     * acted on is answered as it was whatever was published since, and a
     * fresh one is refused as the form says.
     */
    async kept(scope: Scope): Promise<(WriteAnswer & { repeated: true }) | undefined> {
      prune()
      const earlier = kept.get(keyOf(scope))
      if (earlier === undefined || earlier.digest !== digestOf(scope.body)) return undefined
      return { ...(await earlier.answer), repeated: true }
    },
  }
}
