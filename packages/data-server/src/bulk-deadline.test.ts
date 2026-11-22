import { describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import { bulkDeadlineSetting, DEFAULT_BULK_DEADLINE_MS } from './bulk-deadline.js'
import type { ConnectionRegistry } from './connections.js'
import { SQLSERVER_REQUEST_TIMEOUT_MS } from './save-deadline.js'

/*
 * `FORMANCY_DATA_BULK_DEADLINE_MS` (0173, 0175): what the composition root
 * accepts for how long a request that deletes or changes chosen records may
 * go on sending them, by the rule every deadline of this server is read by.
 */

describe('FORMANCY_DATA_BULK_DEADLINE_MS', () => {
  // Unset is the chosen default; a whole number of milliseconds is taken;
  // anything else stops the server with a sentence naming the setting and
  // quoting what was written, which is never a secret. A deadline of 0
  // would answer every record of every request not sent. Watched failing
  // with the digits-only rule taken out: `1e3` was taken as 1000.
  test('is the chosen default unset, a whole number of milliseconds otherwise', () => {
    expect(bulkDeadlineSetting(undefined)).toEqual({ ok: true, ms: DEFAULT_BULK_DEADLINE_MS })
    expect(bulkDeadlineSetting('2500')).toEqual({ ok: true, ms: 2500 })
    for (const written of ['0', '-1', '1.5', '1e3', ' 5', 'abc', '', '2147483648']) {
      expect(bulkDeadlineSetting(written), written).toEqual({
        ok: false,
        problem: `FORMANCY_DATA_BULK_DEADLINE_MS is a whole number of milliseconds from 1 to 2147483647; it is ${JSON.stringify(written)}.`,
      })
    }
  })

  // The default is chosen so that a request whose last record starts just
  // before it answers before nginx's default proxy_read_timeout of 60 s,
  // which the composed stack leaves as it is (bulk-deadline.ts). On SQL
  // Server that record is up to three statements, each bounded by mssql's
  // request timeout: the root's description, the delete, and, where it
  // deleted nothing, the read that says why -- or, for a change (0175), the
  // read that carries the description, the update, and where it changed
  // nothing the read that says why. A default raised past that
  // would have the proxy cut answers the server still writes. Watched
  // failing with the first default of 20 s, chosen while the count was
  // two statements: 20 s and three timeouts are 65 s.
  test('leaves a last record on SQL Server room to answer before the proxy gives up', () => {
    expect(DEFAULT_BULK_DEADLINE_MS + 3 * SQLSERVER_REQUEST_TIMEOUT_MS).toBeLessThan(60_000)
  })

  // A change of a chosen record whose read failed describes the root in a
  // statement of its own before its update, as an update alone does (0040):
  // four statements on SQL Server, and four of mssql's timeouts reach
  // nginx's 60 s by themselves, so no deadline could keep that answer from
  // the proxy -- which 0175 accepts, for a record whose read has already
  // failed, and says. A timeout lowered so four fit makes this fail, and
  // that sentence untrue. Watched failing with SQLSERVER_REQUEST_TIMEOUT_MS
  // at 14 s: four were 56 s.
  test('names the path no default could hold: a change whose read failed is four statements on SQL Server', () => {
    expect(4 * SQLSERVER_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })

  // An embedder's option is held to the variable's rule, so a server is
  // never built that answers every record not sent. Watched failing with
  // the option unchecked: the server was built with a deadline of 0.
  test('as a server option, anything but a whole number of milliseconds stops the server being built', async () => {
    const registry = { ids: () => [], scope: () => undefined, open: async () => undefined, close: async () => {} } as unknown as ConnectionRegistry
    const store = {} as never
    for (const bulkDeadlineMs of [0, 1.5, Number.NaN]) {
      await expect(
        createDataServer({ verifyIdentity: async () => ({ ok: false, reason: 'x' }), runtime: { registry, store, bulkDeadlineMs } }),
      ).rejects.toThrow('runtime.bulkDeadlineMs is a whole number of milliseconds')
    }
  })
})
