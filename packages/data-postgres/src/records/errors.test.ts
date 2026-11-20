import { describe, expect, test } from 'vitest'

import { recordFailure } from './errors.js'

/**
 * An error shaped as postgres.js reports what the server sent: its name, the
 * SQLSTATE, and the severity the server gave it (the ErrorResponse's V
 * field, never localised). Built by hand because which of the two a 42704
 * is depends on when the server sends it; both are also met on real servers,
 * in states-drift.integration.test.ts and parity.integration.test.ts.
 */
function serverError(code: string, severity: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'PostgresError', code, severity })
}

describe('undefined_object, 42704 (0170)', () => {
  // A statement that casts a value to an enum the bindings name, renamed or
  // dropped since it was planned: the schema changed under the form, which
  // a client reads as "generate it again", not a defect of this adapter.
  test('an ERROR the statement met, a type it casts to that is gone, is the schema changed', () => {
    expect(recordFailure(serverError('42704', 'ERROR', 'type "states.priority" does not exist'), 'write')).toMatchObject({
      ok: false,
      code: 'schema-changed',
    })
  })

  // The same code is a setting the server does not know, sent as the
  // connection starts -- transaction_timeout to a PostgreSQL before 17 -- which
  // the server answers FATAL. Read as the schema changed, a deployment's
  // setting at fault would send every administrator to regenerate forms that
  // are fine; it is thrown, as the rest of class 42 is.
  test('a FATAL one, a setting the connection started with that the server does not know, is thrown', () => {
    const fatal = serverError('42704', 'FATAL', 'unrecognized configuration parameter "transaction_timeout"')
    expect(() => recordFailure(fatal, 'write')).toThrow(fatal)
  })
})
