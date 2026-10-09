import { describe, expect, test } from 'vitest'
import { generation } from './columns.js'

/**
 * The mapping from pg_attribute's codes to the contract, as a function: the
 * one branch here no server can reach — an `attidentity` code PostgreSQL 17
 * and 18 do not have — cannot be declared into a real catalog, so it is
 * called directly. Everything the server can produce is proved against one
 * in discovery-types.integration.test.ts.
 */
describe('generation', () => {
  const row = (identity: string, generated = '', default_expression: string | null = null) => ({ identity, generated, default_expression })

  // An identity of a kind nobody has read is still an identity. Falling
  // through to 'none', as it did, made it an ordinary writable column: a
  // form would offer a value the database may refuse, or collide with.
  test('an attidentity code no version has yet is the stricter identity, never an ordinary column', () => {
    expect(generation(row('x'))).toBe('identity-always')
  })

  test('the codes PostgreSQL has, and a sequence default', () => {
    expect(generation(row('a'))).toBe('identity-always')
    expect(generation(row('d'))).toBe('identity-by-default')
    expect(generation(row('', 's'))).toBe('computed')
    expect(generation(row('', '', "nextval('s'::regclass)"))).toBe('identity-by-default')
    expect(generation(row('', '', "nextval('it''s'::regclass)"))).toBe('identity-by-default')
    expect(generation(row('', '', "(nextval('s'::regclass) * 2)"))).toBe('none')
    expect(generation(row('', '', 'now()'))).toBe('none')
    expect(generation(row(''))).toBe('none')
  })
})
