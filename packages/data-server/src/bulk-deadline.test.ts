import { describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import { bulkDeadlineSetting, DEFAULT_BULK_DEADLINE_MS } from './bulk-deadline.js'
import type { ConnectionRegistry } from './connections.js'
import { SQLSERVER_REQUEST_TIMEOUT_MS } from './save-deadline.js'

/*
 * `FORMANCY_DATA_BULK_DEADLINE_MS` (0173): what the composition root
 * accepts for how long a request that deletes chosen records may go on
 * sending them, by the rule every deadline of this server is read by.
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
  // before it -- on SQL Server two statements, each bounded by mssql's
  // request timeout -- answers before nginx's default proxy_read_timeout of
  // 60 s, which the composed stack leaves as it is (bulk-deadline.ts). A
  // default raised past that would have the proxy cut answers the server
  // still writes. Watched failing with a default of 40 s.
  test('leaves a last record on SQL Server room to answer before the proxy gives up', () => {
    expect(DEFAULT_BULK_DEADLINE_MS + 2 * SQLSERVER_REQUEST_TIMEOUT_MS).toBeLessThan(60_000)
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
