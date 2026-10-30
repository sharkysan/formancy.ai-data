import { describe, expect, test } from 'vitest'
import { decodeKeyToken, encodeKeyToken, KEY_TOKEN_MAX_LENGTH } from '../lookup/token.js'
import { decodeListCursor, listCursor } from './cursor.js'
import { DATE, INT32, INT64, column, text } from './test-support.js'

/*
 * A list's cursor (0108): a row's key, spelled as a record token is, under
 * a prefix of its own and without a select's bound. The grammar is the
 * token's, which token.test.ts holds; this holds what is the cursor's own.
 */
describe('a list cursor', () => {
  const identity = [column('tenant_id', INT32), column('code', text(null)), column('day', DATE)]
  const names = identity.map((entry) => entry.name)

  // A cursor read back is the key it was made from, value for value, the
  // characters a token escapes included: a comma inside a value is not a
  // second value.
  test('reads back as the key it spells', () => {
    const values = { tenant_id: '1', code: 'a,b ~ ü', day: '2026-10-30', notes: 'not key' }
    const cursor = listCursor(names, values)
    expect(cursor.startsWith('c1:')).toBe(true)
    expect(decodeListCursor(identity, cursor)).toEqual({
      ok: true,
      key: [
        { name: 'tenant_id', type: INT32, value: '1' },
        { name: 'code', type: text(null), value: 'a,b ~ ü' },
        { name: 'day', type: DATE, value: '2026-10-30' },
      ],
    })
  })

  // A select stores 200 characters, a page shows any row: a page ending on
  // a key no token holds must still be continued after. Watched failing
  // with the token's bound kept.
  test("spells a key past a token's bound", () => {
    const code = '~'.repeat(KEY_TOKEN_MAX_LENGTH)
    expect(encodeKeyToken(['1', code, '2026-10-30'])).toMatchObject({ ok: false, code: 'too-long' })
    const cursor = listCursor(names, { tenant_id: '1', code, day: '2026-10-30' })
    expect(cursor.length).toBeGreaterThan(KEY_TOKEN_MAX_LENGTH)
    expect(decodeListCursor(identity, cursor)).toMatchObject({ ok: true, key: [{ value: '1' }, { value: code }, { value: '2026-10-30' }] })
  })

  // Each is a reference to something else: a token, which names the same
  // key under another prefix; a cursor of another version; one with too few
  // values, or one spelled otherwise than its column holds it.
  test('is refused for a token, another version, another key or another spelling', () => {
    const token = encodeKeyToken(['1', 'x', '2026-10-30'])
    if (!token.ok) throw new Error(token.message)
    expect(decodeKeyToken(listCursor(names, { tenant_id: '1', code: 'x', day: '2026-10-30' }))).toMatchObject({ ok: false, code: 'not-a-token' })
    expect(decodeListCursor(identity, token.token)).toMatchObject({ ok: false, code: 'not-a-token' })
    expect(decodeListCursor(identity, 'c2:1,x,2026-10-30')).toMatchObject({ ok: false, code: 'unsupported-version' })
    expect(decodeListCursor(identity, 'c1:1,x')).toMatchObject({ ok: false, code: 'wrong-length' })
    expect(decodeListCursor(identity, 'c1:01,x,2026-10-30')).toMatchObject({ ok: false, code: 'not-canonical' })
    expect(decodeListCursor(identity, 'c1:1,x,2026-02-30')).toMatchObject({ ok: false, code: 'not-canonical' })
    expect(decodeListCursor([column('id', INT64)], 'c1:9223372036854775808')).toMatchObject({ ok: false, code: 'not-canonical' })
  })

  // listable lists only a key held NOT NULL: a row without one is an adapter
  // that read it wrongly, thrown rather than spelled as a cursor naming
  // another row.
  test('is not made for a row without its key', () => {
    expect(() => listCursor(names, { tenant_id: '1', code: null, day: '2026-10-30' })).toThrow('no key to continue after')
  })
})
