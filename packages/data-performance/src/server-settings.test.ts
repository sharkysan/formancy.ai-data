import { MAX_LOOKUP_DEADLINE_MS } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { serverSettings } from './server-settings.js'

describe('the server a measurement runs', () => {
  // The default lookup deadline is derived from what a run measures (0061),
  // and the file that holds it is left out of the measured product (0063)
  // because a run never meets it. A run that gave the server any shorter
  // deadline would be cut by it, and the figures would then depend on the
  // number they derive -- and the stale check would no longer see it change.
  test('has the longest lookup deadline a timer holds', () => {
    const settings = serverSettings({ storeDir: '/store', connectionsFile: '/connections.json', rateLimit: 1_000_000, port: 4390 })
    expect(settings.FORMANCY_DATA_LOOKUP_DEADLINE_MS).toBe(String(MAX_LOOKUP_DEADLINE_MS))
  })

  // Nothing else of what it is given is lost on the way: the store, the
  // allowlist, the rate limit and the port are the run's own.
  test('is configured with what the run gives it', () => {
    const settings = serverSettings({ storeDir: '/store', connectionsFile: '/connections.json', rateLimit: 1_000_000, port: 4390 })
    expect(settings).toMatchObject({ FORMANCY_DATA_STORE_DIR: '/store', FORMANCY_DATA_CONNECTIONS: '/connections.json', FORMANCY_DATA_RATE_LIMIT: '1000000', PORT: '4390' })
  })
})
