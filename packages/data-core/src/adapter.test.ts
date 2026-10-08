import { describe, expect, test } from 'vitest'
import { DATABASE_KINDS, isDatabaseKind } from './adapter.js'

describe('isDatabaseKind', () => {
  // A composition root reads the kind from configuration. Every kind the
  // release speaks has to pass, or a correct configuration is refused.
  test('accepts exactly the kinds the first release speaks', () => {
    for (const kind of DATABASE_KINDS) expect(isDatabaseKind(kind)).toBe(true)
  })

  // A typo'd kind that passed would reach an adapter lookup and fail there,
  // with a message about a missing module rather than about the configuration.
  // Case matters because the value is what the adapter is looked up by.
  test('refuses a database this release does not speak, a different casing, and anything that is not a string', () => {
    expect(isDatabaseKind('mysql')).toBe(false)
    expect(isDatabaseKind('Postgres')).toBe(false)
    expect(isDatabaseKind(undefined)).toBe(false)
    expect(isDatabaseKind({ kind: 'postgres' })).toBe(false)
  })
})
