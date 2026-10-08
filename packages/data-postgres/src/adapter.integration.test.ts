import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { DatabaseAdapter } from '@formancy/data-core'
import { createPostgresAdapter } from './adapter.js'

/**
 * Against REAL PostgreSQL. There is no mocked driver here and there is not
 * going to be one (0003): what an adapter gets wrong, it gets wrong under real
 * SQL semantics, and a suite that passed without a server would be proving the
 * mock.
 */
let container: StartedPostgreSqlContainer
let adapter: DatabaseAdapter

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start()
  adapter = createPostgresAdapter(postgres(container.getConnectionUri()))
})

afterAll(async () => {
  await adapter.close()
  await container.stop()
})

describe('the PostgreSQL adapter', () => {
  // A ping that answered from the driver's configuration would pass against a
  // server that is not there. The version asserted is the one the container
  // runs, so the answer has to have come from it.
  test('ping reports the server that answered', async () => {
    const identity = await adapter.ping()
    expect(identity.kind).toBe('postgres')
    expect(identity.version).toMatch(/^17\./)
  })

  // A composition root closes on shutdown and again on an error path. The
  // second call must not throw, or the error path hides the original error.
  // Last, because nothing can ping after it.
  test('close is safe to call twice', async () => {
    await adapter.close()
    await expect(adapter.close()).resolves.toBeUndefined()
  })
})
