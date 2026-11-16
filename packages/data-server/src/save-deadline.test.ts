import { DEFAULT_SAVE_DEADLINE_MS } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import type { ConnectionRegistry } from './connections.js'
import { saveDeadlineFit, saveDeadlineSetting, SQLSERVER_REQUEST_TIMEOUT_MS } from './save-deadline.js'

/*
 * `FORMANCY_DATA_SAVE_DEADLINE_MS` (0155): what the composition root
 * accepts, and the start-up check that holds it below mssql's request
 * timeout wherever a SQL Server connection is allowed.
 */

describe('FORMANCY_DATA_SAVE_DEADLINE_MS', () => {
  // Unset is the measured default; a whole number of milliseconds is
  // taken; anything else stops the server with a sentence naming the
  // setting and quoting what was written, which is never a secret. A
  // deadline of 0 or a fraction would refuse, or throw on, every save.
  // Watched failing with the digits-only rule taken out: `1e3` was taken
  // as 1000.
  test('is the measured default unset, a whole number of milliseconds otherwise', () => {
    expect(saveDeadlineSetting(undefined)).toEqual({ ok: true, ms: DEFAULT_SAVE_DEADLINE_MS })
    expect(saveDeadlineSetting('2500')).toEqual({ ok: true, ms: 2500 })
    for (const written of ['0', '-1', '1.5', '1e3', ' 5', 'abc', '', '2147483648']) {
      expect(saveDeadlineSetting(written), written).toEqual({
        ok: false,
        problem: `FORMANCY_DATA_SAVE_DEADLINE_MS is a whole number of milliseconds from 1 to 2147483647; it is ${JSON.stringify(written)}.`,
      })
    }
  })

  // A save's step may start just before the deadline and wait for a lock as
  // long again, so it may run nearly twice the deadline before it is
  // rolled back; on SQL Server that must end before mssql gives up on the
  // batch, past which a save that may commit is unknown where the deadline
  // would have rolled it back. PostgreSQL has no such timeout, and an
  // allowlist without SQL Server is held to nothing. Watched failing with
  // the check asked of every allowlist: a PostgreSQL deployment's 8 s was
  // refused.
  test('is held below half of mssql’s request timeout only where a SQL Server connection is allowed', () => {
    const most = SQLSERVER_REQUEST_TIMEOUT_MS / 2 - 1
    expect(saveDeadlineFit(most, ['postgres', 'sqlserver'])).toBeUndefined()
    expect(saveDeadlineFit(most + 1, ['sqlserver'])).toBe(
      "FORMANCY_DATA_SAVE_DEADLINE_MS is 7500, and with a SQL Server connection allowed twice it must be below mssql's request timeout of 15000 ms: at most 7499.",
    )
    expect(saveDeadlineFit(8000, ['postgres'])).toBeUndefined()
    expect(saveDeadlineFit(8000, [])).toBeUndefined()
    expect(saveDeadlineFit(DEFAULT_SAVE_DEADLINE_MS, ['sqlserver'])).toBeUndefined()
  })

  // An embedder's option is held to the variable's rule, so a server is
  // never built that refuses or throws on every save. Watched failing with
  // the option unchecked: the server was built with a deadline of 0.
  test('as a server option, anything but a whole number of milliseconds stops the server being built', async () => {
    const registry = { ids: () => [], scope: () => undefined, open: async () => undefined, close: async () => {} } as unknown as ConnectionRegistry
    const store = {} as never
    for (const saveDeadlineMs of [0, 1.5, Number.NaN]) {
      await expect(
        createDataServer({ verifyIdentity: async () => ({ ok: false, reason: 'x' }), runtime: { registry, store, saveDeadlineMs } }),
      ).rejects.toThrow('runtime.saveDeadlineMs is a whole number of milliseconds')
    }
  })
})
