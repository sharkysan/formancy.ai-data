import type { ApiValue } from '../codecs/codec.js'
import { decodeKeyToken, encodeKeyToken } from '../lookup/token.js'
import type { KeyTokenErrorCode } from '../lookup/token.js'
import type { LookupKeyColumn } from '../lookup/types.js'
import { isKeyValue, isLookupKeyType } from '../lookup/values.js'
import type { RecordColumn, RecordValue } from './types.js'

/**
 * How the API names one record: the key token of its identity values — the
 * same versioned encoding a lookup's select stores (0012) — so a composite key
 * travels as one unambiguous string, an integer key reads as itself in a log,
 * and the two encodings cannot drift apart because there is one.
 *
 * Like a lookup token it is a reference and never a permission. Whether the
 * actor may read or change the record it names is decided by the adapter,
 * under the actor's trusted filters, in the same statement.
 */

/**
 * `no-value` — an identity value that is NULL, missing or not text.
 * `wrong-length` — a token with more or fewer values than the key has columns.
 * `not-canonical` — a value its key column cannot hold in that spelling.
 * `not-addressable` — a key of a kind with no settled spelling, or no key.
 * The rest are the key-token decoder's.
 */
export type RecordTokenErrorCode = KeyTokenErrorCode | 'no-value' | 'wrong-length' | 'not-canonical' | 'not-addressable'

export interface RecordTokenRefusal {
  ok: false
  code: RecordTokenErrorCode
  /** A sentence for a log. It names columns and positions, never a value. */
  message: string
}

export type RecordTokenEncoding = { ok: true; token: string } | RecordTokenRefusal
export type RecordKeyDecoding = { ok: true; key: RecordValue[] } | RecordTokenRefusal

function refuse(code: RecordTokenErrorCode, message: string): RecordTokenRefusal {
  return { ok: false, code, message }
}

/**
 * The token for a record, from its identity columns' canonical values as a
 * read returned them.
 *
 * A NULL is refused, never spelled: a nullable unique key can hold one, and a
 * record whose key is NULL cannot be addressed by equality on either engine.
 * A number is refused too, because a canonical key value is text (0008).
 */
export function recordToken(identity: readonly string[], values: Readonly<Record<string, ApiValue>>): RecordTokenEncoding {
  if (identity.length === 0) return refuse('no-value', 'This form identifies no record, so a record has no token.')
  const key: string[] = []
  for (const column of identity) {
    const value = Object.hasOwn(values, column) ? values[column] : undefined
    if (typeof value !== 'string') return refuse('no-value', `${column} holds no text, so this record cannot be addressed.`)
    key.push(value)
  }
  const encoded = encodeKeyToken(key)
  return encoded.ok ? encoded : refuse(encoded.code, encoded.message)
}

/**
 * The key a record token names, with each value checked against its identity
 * column: one value per column, each spelled exactly as the column holds it,
 * as a lookup's key is checked before anything is bound (0012).
 *
 * A value spelled any other way cannot name a record — `007` would be a second
 * token for record 7 — and binding it would be a conversion error on one
 * engine and a quiet non-match on the other.
 */
export function decodeRecordKey(identity: readonly RecordColumn[], token: string): RecordKeyDecoding {
  if (identity.length === 0) return refuse('not-addressable', 'This form identifies no record, so no token can name one.')
  const columns: LookupKeyColumn[] = []
  for (const column of identity) {
    if (!isLookupKeyType(column.type)) {
      return refuse('not-addressable', `Key column ${column.name} is a ${column.type.kind}, which has no settled spelling for a token.`)
    }
    columns.push({ name: column.name, type: column.type })
  }

  const decoded = decodeKeyToken(token)
  if (!decoded.ok) return decoded
  if (decoded.values.length !== columns.length) {
    return refuse('wrong-length', `This token holds ${String(decoded.values.length)} values, and a record of this form is named by ${String(columns.length)}.`)
  }

  const key: RecordValue[] = []
  for (const [index, column] of columns.entries()) {
    // Equal lengths, so every index has a value.
    const value = decoded.values[index] as string
    if (!isKeyValue(column.type, value)) {
      return refuse('not-canonical', `Value ${String(index + 1)} of this token is not spelled as ${column.name} holds it.`)
    }
    key.push({ name: column.name, type: column.type, value })
  }
  return { ok: true, key }
}
